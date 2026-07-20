import { cpus } from "node:os"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"

export type BenchmarkTier = "core" | "extended" | "stress"

export interface BenchmarkRuntime {
  run(iteration: number): unknown
  validate(): void
  cleanup?: () => void
  workPerOperation?: number
  workLabel?: string
  bytesPerOperation?: number
  memoryIterations?: number
}

export interface BenchmarkScenario {
  name: string
  description: string
  category: string
  source: "opentui" | "library"
  tier: BenchmarkTier
  setup(): BenchmarkRuntime
}

interface BenchmarkSample {
  round: number
  iterations: number
  durationMs: number
  nsPerOperation: number
  opsPerSecond: number
  errors: number
}

interface BenchmarkResult {
  name: string
  description: string
  category: string
  source: BenchmarkScenario["source"]
  tier: BenchmarkTier
  batchIterations: number
  attempts: number
  sampleDurationMs: number
  totalOperations: number
  workPerOperation: number
  workLabel: string
  bytesPerOperation: number
  medianNsPerOperation: number
  medianNsPerWorkItem: number
  p95NsPerOperation: number
  meanNsPerOperation: number
  stdDevNsPerOperation: number
  rmePercent: number
  medianOpsPerSecond: number
  medianWorkPerSecond: number
  medianMiBPerSecond: number | null
  errorCount: number
  errorRatePercent: number
  stable: boolean
  firstError?: string
  samples: BenchmarkSample[]
}

interface MemoryDelta {
  rss: number
  heapTotal: number
  heapUsed: number
  external: number
  arrayBuffers: number
}

interface MemoryTrial {
  iterations: number
  retainedPerOperation: MemoryDelta
  residual: MemoryDelta
  errors: number
}

interface MemoryResult {
  name: string
  iterations: number
  trials: number
  errorCount: number
  errorRatePercent: number
  medianRetainedPerOperation: MemoryDelta
  medianResidual: MemoryDelta
  samples: MemoryTrial[]
}

interface BenchmarkOptions {
  rawArgs: string[]
  profile: "quick" | "default" | "full"
  initialIterations: number
  warmupIterations: number
  rounds: number
  minSampleMs: number
  maxRmePercent: number
  maxAttempts: number
  maxBatchIterations: number
  filters: string[]
  exactScenarios: Set<string> | null
  listScenarios: boolean
  verbose: boolean
  output: boolean
  allowUnstable: boolean
  jsonPath?: string
  overwriteJson: boolean
  memory: boolean
  memoryTrials: number
}

const blackhole: { value: unknown; checksum: number } = { value: undefined, checksum: 0 }
let retainedMemoryOutputs: unknown[] | undefined

const profileDefaults = {
  quick: {
    initialIterations: 25,
    warmupIterations: 25,
    rounds: 3,
    minSampleMs: 20,
    maxRmePercent: 50,
    maxAttempts: 2,
  },
  default: {
    initialIterations: 100,
    warmupIterations: 100,
    rounds: 5,
    minSampleMs: 100,
    maxRmePercent: 7.5,
    maxAttempts: 4,
  },
  full: {
    initialIterations: 100,
    warmupIterations: 200,
    rounds: 7,
    minSampleMs: 250,
    maxRmePercent: 5,
    maxAttempts: 4,
  },
} as const

function parsePositiveNumber(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number, got ${raw}`)
  return value
}

function parsePositiveInteger(raw: string | undefined, name: string, fallback: number, minimum = 1): number {
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}, got ${raw}`)
  }
  return value
}

function readOption(args: string[], index: number, name: string): [string, number] {
  const value = args[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`)
  return [value, index + 1]
}

function parseArgs(args: string[]): BenchmarkOptions {
  let profile = (process.env.BENCH_PROFILE ?? "default") as BenchmarkOptions["profile"]
  let initialIterations: number | undefined
  let warmupIterations: number | undefined
  let rounds: number | undefined
  let minSampleMs: number | undefined
  let maxRmePercent: number | undefined
  let maxAttempts: number | undefined
  let maxBatchIterations = parsePositiveInteger(process.env.BENCH_MAX_BATCH, "BENCH_MAX_BATCH", 1_000_000)
  let exactScenarios: Set<string> | null = null
  const filters: string[] = []
  let listScenarios = false
  let verbose = false
  let output = true
  let allowUnstable = false
  let jsonPath: string | undefined
  let overwriteJson = false
  let memory = false
  let memoryTrials = 3

  const envFilter = process.env.BENCH_FILTER
  if (envFilter)
    filters.push(
      ...envFilter
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    )

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--profile") {
      const [value, next] = readOption(args, index, arg)
      profile = value as BenchmarkOptions["profile"]
      index = next
    } else if (arg === "--iterations") {
      const [value, next] = readOption(args, index, arg)
      initialIterations = parsePositiveInteger(value, arg, 1)
      index = next
    } else if (arg === "--warmup") {
      const [value, next] = readOption(args, index, arg)
      warmupIterations = parsePositiveInteger(value, arg, 1)
      index = next
    } else if (arg === "--rounds") {
      const [value, next] = readOption(args, index, arg)
      rounds = parsePositiveInteger(value, arg, 2, 2)
      index = next
    } else if (arg === "--min-sample-ms") {
      const [value, next] = readOption(args, index, arg)
      minSampleMs = parsePositiveNumber(value, arg, 1)
      index = next
    } else if (arg === "--max-rme") {
      const [value, next] = readOption(args, index, arg)
      maxRmePercent = parsePositiveNumber(value, arg, 1)
      index = next
    } else if (arg === "--max-attempts") {
      const [value, next] = readOption(args, index, arg)
      maxAttempts = parsePositiveInteger(value, arg, 1)
      index = next
    } else if (arg === "--max-batch") {
      const [value, next] = readOption(args, index, arg)
      maxBatchIterations = parsePositiveInteger(value, arg, 1)
      index = next
    } else if (arg === "--filter") {
      const [value, next] = readOption(args, index, arg)
      filters.push(
        ...value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      )
      index = next
    } else if (arg === "--scenario") {
      const [value, next] = readOption(args, index, arg)
      exactScenarios = new Set(
        value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      )
      index = next
    } else if (arg === "--json") {
      const [value, next] = readOption(args, index, arg)
      jsonPath = value
      index = next
    } else if (arg === "--memory-trials") {
      const [value, next] = readOption(args, index, arg)
      memoryTrials = parsePositiveInteger(value, arg, 1)
      index = next
    } else if (arg === "--list") {
      listScenarios = true
    } else if (arg === "--verbose") {
      verbose = true
    } else if (arg === "--quiet") {
      output = false
    } else if (arg === "--allow-unstable") {
      allowUnstable = true
    } else if (arg === "--overwrite") {
      overwriteJson = true
    } else if (arg === "--memory") {
      memory = true
    } else {
      throw new Error(`Unknown benchmark option: ${arg}`)
    }
  }

  if (profile !== "quick" && profile !== "default" && profile !== "full") {
    throw new Error(`--profile must be quick, default, or full; got ${profile}`)
  }

  const defaults = profileDefaults[profile]
  return {
    rawArgs: [...args],
    profile,
    initialIterations: initialIterations ?? defaults.initialIterations,
    warmupIterations: warmupIterations ?? defaults.warmupIterations,
    rounds: rounds ?? defaults.rounds,
    minSampleMs: minSampleMs ?? defaults.minSampleMs,
    maxRmePercent: maxRmePercent ?? defaults.maxRmePercent,
    maxAttempts: maxAttempts ?? defaults.maxAttempts,
    maxBatchIterations,
    filters,
    exactScenarios,
    listScenarios,
    verbose,
    output,
    allowUnstable,
    jsonPath,
    overwriteJson,
    memory,
    memoryTrials,
  }
}

function nowNs(): bigint {
  return process.hrtime.bigint()
}

function nsToMs(value: bigint): number {
  return Number(value) / 1_000_000
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((total, value) => total + value, 0) / values.length
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

function percentile(values: readonly number[], value: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((value / 100) * sorted.length) - 1))
  return sorted[index] ?? 0
}

function sampleStdDev(values: readonly number[]): number {
  if (values.length <= 1) return 0
  const average = mean(values)
  return Math.sqrt(values.reduce((total, value) => total + (value - average) ** 2, 0) / (values.length - 1))
}

function tCritical95(degreesOfFreedom: number): number {
  const table = [
    12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11,
    2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
  ]
  if (degreesOfFreedom <= 0) return 0
  return table[degreesOfFreedom - 1] ?? 1.96
}

function relativeMarginOfError(values: readonly number[]): number {
  if (values.length <= 1) return 0
  const average = mean(values)
  if (average === 0) return 0
  const standardError = sampleStdDev(values) / Math.sqrt(values.length)
  return Math.abs((standardError * tCritical95(values.length - 1) * 100) / average)
}

function consume(value: unknown): void {
  blackhole.value = value
  let contribution = 1
  if (typeof value === "number") contribution = value | 0
  else if (typeof value === "bigint") contribution = Number(value & 0xffffffffn)
  else if (typeof value === "string" || Array.isArray(value)) contribution = value.length
  else if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) contribution = value.byteLength
  else if (value instanceof Map || value instanceof Set) contribution = value.size
  else if (typeof value === "boolean") contribution = value ? 1 : 0
  else if (value === null || value === undefined) contribution = 0
  blackhole.checksum = (blackhole.checksum + contribution) >>> 0
}

function roundIterations(value: number): number {
  if (value <= 100) return Math.max(1, Math.ceil(value))
  if (value <= 1_000) return Math.ceil(value / 10) * 10
  if (value <= 10_000) return Math.ceil(value / 100) * 100
  if (value <= 100_000) return Math.ceil(value / 1_000) * 1_000
  return Math.ceil(value / 10_000) * 10_000
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function runIterations(
  runtime: BenchmarkRuntime,
  count: number,
  startIteration: number,
  tolerateErrors: boolean,
): { nextIteration: number; errors: number; firstError?: string } {
  let errors = 0
  let firstError: string | undefined
  for (let iteration = 0; iteration < count; iteration += 1) {
    try {
      consume(runtime.run(startIteration + iteration))
    } catch (error) {
      errors += 1
      firstError ??= errorMessage(error)
      if (!tolerateErrors) throw error
    }
  }
  return { nextIteration: startIteration + count, errors, firstError }
}

function calibrate(runtime: BenchmarkRuntime, options: BenchmarkOptions, startIteration: number) {
  const calibrationIterations = Math.min(options.initialIterations, options.maxBatchIterations)
  const start = nowNs()
  const run = runIterations(runtime, calibrationIterations, startIteration, false)
  const durationMs = nsToMs(nowNs() - start)
  let batchIterations = calibrationIterations
  if (durationMs > 0 && durationMs < options.minSampleMs) {
    batchIterations = Math.min(
      options.maxBatchIterations,
      roundIterations((batchIterations * options.minSampleMs) / durationMs),
    )
  }
  return { batchIterations, nextIteration: run.nextIteration }
}

function runTimedAttempt(
  runtime: BenchmarkRuntime,
  options: BenchmarkOptions,
  batchIterations: number,
  startIteration: number,
  sampleDurationMs: number,
): { samples: BenchmarkSample[]; nextIteration: number; firstError?: string } {
  const samples: BenchmarkSample[] = []
  let nextIteration = startIteration
  let firstError: string | undefined

  for (let round = 0; round < options.rounds; round += 1) {
    const start = nowNs()
    let iterations = 0
    let errors = 0
    let durationMs = 0
    do {
      const run = runIterations(runtime, batchIterations, nextIteration, true)
      nextIteration = run.nextIteration
      iterations += batchIterations
      errors += run.errors
      firstError ??= run.firstError
      durationMs = nsToMs(nowNs() - start)
    } while (durationMs < sampleDurationMs)

    samples.push({
      round: round + 1,
      iterations,
      durationMs,
      nsPerOperation: (durationMs * 1_000_000) / iterations,
      opsPerSecond: (iterations * 1000) / durationMs,
      errors,
    })
  }

  return { samples, nextIteration, firstError }
}

function buildResult(
  scenario: BenchmarkScenario,
  runtime: BenchmarkRuntime,
  samples: BenchmarkSample[],
  batchIterations: number,
  attempts: number,
  sampleDurationMs: number,
  firstError: string | undefined,
  maxRmePercent: number,
): BenchmarkResult {
  const nsPerOperation = samples.map((sample) => sample.nsPerOperation)
  const opsPerSecond = samples.map((sample) => sample.opsPerSecond)
  const totalOperations = samples.reduce((total, sample) => total + sample.iterations, 0)
  const errorCount = samples.reduce((total, sample) => total + sample.errors, 0)
  const workPerOperation = runtime.workPerOperation ?? 1
  const bytesPerOperation = runtime.bytesPerOperation ?? 0
  const medianOpsPerSecond = median(opsPerSecond)
  const rmePercent = relativeMarginOfError(nsPerOperation)

  return {
    name: scenario.name,
    description: scenario.description,
    category: scenario.category,
    source: scenario.source,
    tier: scenario.tier,
    batchIterations,
    attempts,
    sampleDurationMs,
    totalOperations,
    workPerOperation,
    workLabel: runtime.workLabel ?? "operations",
    bytesPerOperation,
    medianNsPerOperation: median(nsPerOperation),
    medianNsPerWorkItem: median(nsPerOperation) / workPerOperation,
    p95NsPerOperation: percentile(nsPerOperation, 95),
    meanNsPerOperation: mean(nsPerOperation),
    stdDevNsPerOperation: sampleStdDev(nsPerOperation),
    rmePercent,
    medianOpsPerSecond,
    medianWorkPerSecond: medianOpsPerSecond * workPerOperation,
    medianMiBPerSecond: bytesPerOperation > 0 ? (medianOpsPerSecond * bytesPerOperation) / (1024 * 1024) : null,
    errorCount,
    errorRatePercent: totalOperations > 0 ? (errorCount * 100) / totalOperations : 0,
    stable: errorCount === 0 && rmePercent <= maxRmePercent,
    firstError,
    samples,
  }
}

function runScenario(scenario: BenchmarkScenario, options: BenchmarkOptions): BenchmarkResult {
  const runtime = scenario.setup()
  try {
    runtime.validate()
    let nextIteration = runIterations(runtime, options.warmupIterations, 0, false).nextIteration
    const calibration = calibrate(runtime, options, nextIteration)
    nextIteration = calibration.nextIteration
    const batchIterations = calibration.batchIterations
    if (batchIterations !== options.initialIterations) {
      nextIteration = runIterations(
        runtime,
        Math.min(batchIterations, options.warmupIterations),
        nextIteration,
        false,
      ).nextIteration
    }

    let sampleDurationMs = options.minSampleMs
    let result: BenchmarkResult | undefined
    for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
      forceGC()
      const measured = runTimedAttempt(runtime, options, batchIterations, nextIteration, sampleDurationMs)
      nextIteration = measured.nextIteration
      result = buildResult(
        scenario,
        runtime,
        measured.samples,
        batchIterations,
        attempt,
        sampleDurationMs,
        measured.firstError,
        options.maxRmePercent,
      )
      if (result.errorCount > 0 || result.rmePercent <= options.maxRmePercent) break
      sampleDurationMs *= 2
    }

    return result!
  } finally {
    runtime.cleanup?.()
  }
}

function usageDelta(after: NodeJS.MemoryUsage, before: NodeJS.MemoryUsage): MemoryDelta {
  return {
    rss: after.rss - before.rss,
    heapTotal: after.heapTotal - before.heapTotal,
    heapUsed: after.heapUsed - before.heapUsed,
    external: after.external - before.external,
    arrayBuffers: after.arrayBuffers - before.arrayBuffers,
  }
}

function subtractDelta(value: MemoryDelta, control: MemoryDelta): MemoryDelta {
  return {
    rss: value.rss - control.rss,
    heapTotal: value.heapTotal - control.heapTotal,
    heapUsed: value.heapUsed - control.heapUsed,
    external: value.external - control.external,
    arrayBuffers: value.arrayBuffers - control.arrayBuffers,
  }
}

function divideDelta(value: MemoryDelta, divisor: number): MemoryDelta {
  return {
    rss: value.rss / divisor,
    heapTotal: value.heapTotal / divisor,
    heapUsed: value.heapUsed / divisor,
    external: value.external / divisor,
    arrayBuffers: value.arrayBuffers / divisor,
  }
}

function medianDelta(values: MemoryDelta[]): MemoryDelta {
  return {
    rss: median(values.map((value) => value.rss)),
    heapTotal: median(values.map((value) => value.heapTotal)),
    heapUsed: median(values.map((value) => value.heapUsed)),
    external: median(values.map((value) => value.external)),
    arrayBuffers: median(values.map((value) => value.arrayBuffers)),
  }
}

function forceGC(): void {
  Bun.gc(true)
  Bun.gc(true)
}

function defaultMemoryIterations(runtime: BenchmarkRuntime): number {
  if (runtime.memoryIterations) return runtime.memoryIterations
  const estimatedBytes = Math.max(128, runtime.bytesPerOperation ?? 128)
  return Math.max(100, Math.min(10_000, Math.floor((8 * 1024 * 1024) / estimatedBytes)))
}

function runMemoryScenario(scenario: BenchmarkScenario, options: BenchmarkOptions): MemoryResult {
  const runtime = scenario.setup()
  const iterations = defaultMemoryIterations(runtime)
  const samples: MemoryTrial[] = []
  let errorCount = 0

  try {
    runtime.validate()
    runIterations(runtime, Math.min(100, iterations), 0, false)

    for (let trial = 0; trial < options.memoryTrials; trial += 1) {
      forceGC()
      const controlBefore = process.memoryUsage()
      let control: unknown[] | undefined = new Array(iterations).fill(blackhole)
      retainedMemoryOutputs = control
      forceGC()
      const controlDelta = usageDelta(process.memoryUsage(), controlBefore)
      control = undefined
      retainedMemoryOutputs = undefined
      forceGC()

      const before = process.memoryUsage()
      let outputs: unknown[] | undefined = new Array<unknown>(iterations)
      let errors = 0
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        try {
          outputs[iteration] = runtime.run(iteration)
        } catch {
          errors += 1
        }
      }
      retainedMemoryOutputs = outputs
      forceGC()
      const retained = subtractDelta(usageDelta(process.memoryUsage(), before), controlDelta)
      retainedMemoryOutputs = undefined
      outputs = undefined
      forceGC()
      const residual = usageDelta(process.memoryUsage(), before)
      errorCount += errors
      samples.push({
        iterations,
        retainedPerOperation: divideDelta(retained, iterations),
        residual,
        errors,
      })
    }
  } finally {
    retainedMemoryOutputs = undefined
    runtime.cleanup?.()
  }

  const totalOperations = iterations * options.memoryTrials
  return {
    name: scenario.name,
    iterations,
    trials: options.memoryTrials,
    errorCount,
    errorRatePercent: totalOperations > 0 ? (errorCount * 100) / totalOperations : 0,
    medianRetainedPerOperation: medianDelta(samples.map((sample) => sample.retainedPerOperation)),
    medianResidual: medianDelta(samples.map((sample) => sample.residual)),
    samples,
  }
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (Math.abs(value) >= 1_000_000) return value.toExponential(3)
  if (Math.abs(value) >= 100) return value.toFixed(1)
  if (Math.abs(value) >= 1) return value.toFixed(2)
  return value.toFixed(4)
}

function formatBytes(value: number): string {
  const sign = value < 0 ? "-" : ""
  let amount = Math.abs(value)
  const units = ["B", "KiB", "MiB", "GiB"]
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  return `${sign}${formatNumber(amount)} ${units[unit]}`
}

function printTable(header: string[], rows: string[][]): void {
  const widths = header.map((title, index) => Math.max(title.length, ...rows.map((row) => row[index]?.length ?? 0)))
  const line = (row: string[]) => row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join("  ")
  console.log(line(header))
  console.log(widths.map((width) => "-".repeat(width)).join("  "))
  for (const row of rows) console.log(line(row))
}

function printResults(results: BenchmarkResult[], options: BenchmarkOptions): void {
  console.log(
    `bun-ffi-structs profile=${options.profile} rounds=${options.rounds} min_sample_ms=${options.minSampleMs} max_rme=${options.maxRmePercent}% scenarios=${results.length} checksum=${blackhole.checksum}`,
  )
  console.log("")
  printTable(
    ["scenario", "source", "batch", "median ns/op", "ns/item", "p95 ns/op", "rme %", "error %", "work/s", "MiB/s"],
    results.map((result) => [
      result.name,
      result.source,
      String(result.batchIterations),
      formatNumber(result.medianNsPerOperation),
      formatNumber(result.medianNsPerWorkItem),
      formatNumber(result.p95NsPerOperation),
      formatNumber(result.rmePercent),
      formatNumber(result.errorRatePercent),
      formatNumber(result.medianWorkPerSecond),
      result.medianMiBPerSecond === null ? "-" : formatNumber(result.medianMiBPerSecond),
    ]),
  )

  if (options.verbose) {
    console.log("")
    for (const result of results) {
      console.log(`${result.name}: ${result.description}`)
      for (const sample of result.samples) {
        console.log(
          `  round=${sample.round} iterations=${sample.iterations} duration_ms=${formatNumber(sample.durationMs)} ns_op=${formatNumber(sample.nsPerOperation)} errors=${sample.errors}`,
        )
      }
    }
  }
}

function printMemoryResults(results: MemoryResult[]): void {
  console.log("\nRetained memory after GC (retention-array control subtracted; median across trials)")
  printTable(
    ["scenario", "iterations", "trials", "heap/op", "external/op", "array buffers/op", "rss/op", "error %"],
    results.map((result) => [
      result.name,
      String(result.iterations),
      String(result.trials),
      formatBytes(result.medianRetainedPerOperation.heapUsed),
      formatBytes(result.medianRetainedPerOperation.external),
      formatBytes(result.medianRetainedPerOperation.arrayBuffers),
      formatBytes(result.medianRetainedPerOperation.rss),
      formatNumber(result.errorRatePercent),
    ]),
  )
}

function selectedByProfile(tier: BenchmarkTier, profile: BenchmarkOptions["profile"]): boolean {
  if (profile === "full") return true
  if (profile === "default") return tier !== "stress"
  return tier === "core"
}

function selectScenarios(scenarios: BenchmarkScenario[], options: BenchmarkOptions): BenchmarkScenario[] {
  return scenarios.filter((scenario) => {
    if (!options.exactScenarios && !selectedByProfile(scenario.tier, options.profile)) return false
    if (options.exactScenarios && !options.exactScenarios.has(scenario.name)) return false
    if (options.filters.length === 0) return true
    const haystack = `${scenario.name} ${scenario.category} ${scenario.description}`.toLowerCase()
    return options.filters.some((filter) => haystack.includes(filter.toLowerCase()))
  })
}

function writeJson(
  path: string,
  options: BenchmarkOptions,
  results: BenchmarkResult[],
  memoryResults: MemoryResult[],
): void {
  const absolutePath = isAbsolute(path) ? path : resolve(process.cwd(), path)
  if (existsSync(absolutePath) && !options.overwriteJson) {
    throw new Error(`Benchmark output file already exists: ${absolutePath}; pass --overwrite to replace it`)
  }
  mkdirSync(dirname(absolutePath), { recursive: true })
  const cpu = cpus()[0]
  writeFileSync(
    absolutePath,
    JSON.stringify(
      {
        meta: {
          timestamp: new Date().toISOString(),
          cwd: process.cwd(),
          args: options.rawArgs,
          profile: options.profile,
          initialIterations: options.initialIterations,
          warmupIterations: options.warmupIterations,
          rounds: options.rounds,
          minSampleMs: options.minSampleMs,
          maxRmePercent: options.maxRmePercent,
          maxAttempts: options.maxAttempts,
          maxBatchIterations: options.maxBatchIterations,
          runtime: {
            bun: Bun.version,
            node: process.versions.node,
            v8: process.versions.v8,
            platform: process.platform,
            arch: process.arch,
          },
          cpu: { model: cpu?.model, speedMHz: cpu?.speed, logicalCpus: cpus().length },
          commit: process.env.GITHUB_SHA ?? process.env.BENCH_COMMIT,
          blackholeChecksum: blackhole.checksum,
        },
        results,
        memoryResults,
      },
      null,
      2,
    ),
  )
}

export async function runBenchmarkSuite(
  scenarios: BenchmarkScenario[],
  args: string[] = process.argv.slice(2),
): Promise<void> {
  const options = parseArgs(args)
  if (options.listScenarios) {
    for (const scenario of scenarios) {
      console.log(`${scenario.name}\t${scenario.tier}\t${scenario.source}\t${scenario.description}`)
    }
    return
  }

  if (options.exactScenarios) {
    const available = new Set(scenarios.map((scenario) => scenario.name))
    const missing = [...options.exactScenarios].filter((name) => !available.has(name))
    if (missing.length > 0) throw new Error(`Unknown benchmark scenarios: ${missing.join(", ")}`)
  }

  const selected = selectScenarios(scenarios, options)
  if (selected.length === 0) throw new Error("No benchmark scenarios matched the selected profile and filters")
  if (options.jsonPath) {
    const absolutePath = isAbsolute(options.jsonPath) ? options.jsonPath : resolve(process.cwd(), options.jsonPath)
    if (existsSync(absolutePath) && !options.overwriteJson) {
      throw new Error(`Benchmark output file already exists: ${absolutePath}; pass --overwrite to replace it`)
    }
  }

  const results: BenchmarkResult[] = []
  for (const scenario of selected) {
    if (options.output) process.stdout.write(`running ${scenario.name} ... `)
    const result = runScenario(scenario, options)
    results.push(result)
    if (options.output) {
      console.log(
        `${formatNumber(result.medianNsPerOperation)} ns/op rme=${formatNumber(result.rmePercent)}% errors=${result.errorCount}`,
      )
    }
  }

  if (options.output) printResults(results, options)
  const memoryResults = options.memory ? selected.map((scenario) => runMemoryScenario(scenario, options)) : []
  if (options.output && memoryResults.length > 0) printMemoryResults(memoryResults)
  if (options.jsonPath) writeJson(options.jsonPath, options, results, memoryResults)

  const failed = results.filter((result) => result.errorCount > 0)
  const unstable = results.filter((result) => result.errorCount === 0 && !result.stable)
  const memoryFailed = memoryResults.filter((result) => result.errorCount > 0)
  if (failed.length > 0 || memoryFailed.length > 0) {
    throw new Error(
      `Benchmark operation errors: ${[...failed, ...memoryFailed].map((result) => result.name).join(", ")}`,
    )
  }
  if (unstable.length > 0 && !options.allowUnstable) {
    throw new Error(
      `Unstable benchmark results exceeded ${options.maxRmePercent}% RME after retries: ${unstable.map((result) => `${result.name} (${formatNumber(result.rmePercent)}%)`).join(", ")}`,
    )
  }
}
