import { cpus } from "node:os"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"
import { Bench, type Statistics, type Task } from "tinybench"

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
  source: "opentui" | "library" | "legacy"
  tier: BenchmarkTier
  setup(): BenchmarkRuntime
}

interface StatisticsSummary {
  aad: number
  critical: number
  df: number
  mad: number
  max: number
  mean: number
  min: number
  moe: number
  p50: number
  p75: number
  p99: number
  p995: number
  p999: number
  rme: number
  samplesCount: number
  sd: number
  sem: number
  variance: number
  samples?: readonly number[]
}

interface BenchmarkResult {
  name: string
  description: string
  category: string
  source: BenchmarkScenario["source"]
  tier: BenchmarkTier
  state: "completed" | "errored"
  attempts: number
  timeMs: number
  warmupTimeMs: number
  operations: number
  attemptedOperations: number
  workPerOperation: number
  workLabel: string
  bytesPerOperation: number
  latency?: StatisticsSummary
  throughput?: StatisticsSummary
  periodMs?: number
  totalTimeMs?: number
  medianNsPerOperation?: number
  p99NsPerOperation?: number
  medianNsPerWorkItem?: number
  medianWorkPerSecond?: number
  medianMiBPerSecond?: number | null
  errorCount: number
  errorRatePercent: number
  stable: boolean
  firstError?: string
  runtime?: string
  runtimeVersion?: string
  timestampProviderName?: string
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
  timeMs: number
  iterations: number
  warmup: boolean
  warmupTimeMs: number
  warmupIterations: number
  maxRmePercent: number
  maxAttempts: number
  retainSamples: boolean
  filters: string[]
  exactScenarios: Set<string> | null
  listScenarios: boolean
  verbose: boolean
  output: boolean
  strictRme: boolean
  allowUnstable: boolean
  jsonPath?: string
  overwriteJson: boolean
  memory: boolean
  memoryTrials: number
}

interface TinybenchAttempt {
  task: Task
  attemptedOperations: number
  errorCount: number
  firstError?: string
  timeMs: number
}

const TINYBENCH_VERSION = "6.0.2"
const benchmarkMarker = { checksum: 0 }
let retainedMemoryOutputs: unknown[] | undefined

const profileDefaults = {
  quick: {
    timeMs: 20,
    iterations: 64,
    warmupTimeMs: 10,
    warmupIterations: 16,
    maxRmePercent: 50,
    maxAttempts: 2,
  },
  default: {
    timeMs: 100,
    iterations: 64,
    warmupTimeMs: 50,
    warmupIterations: 32,
    maxRmePercent: 7.5,
    maxAttempts: 4,
  },
  full: {
    timeMs: 250,
    iterations: 64,
    warmupTimeMs: 100,
    warmupIterations: 64,
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
  let timeMs: number | undefined
  let iterations: number | undefined
  let warmup = true
  let warmupTimeMs: number | undefined
  let warmupIterations: number | undefined
  let maxRmePercent: number | undefined
  let maxAttempts: number | undefined
  let retainSamples = false
  let exactScenarios: Set<string> | null = null
  const filters: string[] = []
  let listScenarios = false
  let verbose = false
  let output = true
  let strictRme = false
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
    } else if (arg === "--time" || arg === "--min-sample-ms") {
      const [value, next] = readOption(args, index, arg)
      timeMs = parsePositiveNumber(value, arg, 1)
      index = next
    } else if (arg === "--iterations") {
      const [value, next] = readOption(args, index, arg)
      iterations = parsePositiveInteger(value, arg, 2, 2)
      index = next
    } else if (arg === "--warmup-time") {
      const [value, next] = readOption(args, index, arg)
      warmupTimeMs = parsePositiveNumber(value, arg, 1)
      index = next
    } else if (arg === "--warmup-iterations" || arg === "--warmup") {
      const [value, next] = readOption(args, index, arg)
      warmupIterations = parsePositiveInteger(value, arg, 1)
      index = next
    } else if (arg === "--max-rme") {
      const [value, next] = readOption(args, index, arg)
      maxRmePercent = parsePositiveNumber(value, arg, 1)
      index = next
    } else if (arg === "--max-attempts") {
      const [value, next] = readOption(args, index, arg)
      maxAttempts = parsePositiveInteger(value, arg, 1)
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
    } else if (arg === "--no-warmup") {
      warmup = false
    } else if (arg === "--retain-samples") {
      retainSamples = true
    } else if (arg === "--list") {
      listScenarios = true
    } else if (arg === "--verbose") {
      verbose = true
    } else if (arg === "--quiet") {
      output = false
    } else if (arg === "--strict-rme") {
      strictRme = true
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
    timeMs: timeMs ?? defaults.timeMs,
    iterations: iterations ?? defaults.iterations,
    warmup,
    warmupTimeMs: warmupTimeMs ?? defaults.warmupTimeMs,
    warmupIterations: warmupIterations ?? defaults.warmupIterations,
    maxRmePercent: maxRmePercent ?? defaults.maxRmePercent,
    maxAttempts: maxAttempts ?? defaults.maxAttempts,
    retainSamples,
    filters,
    exactScenarios,
    listScenarios,
    verbose,
    output,
    strictRme,
    allowUnstable,
    jsonPath,
    overwriteJson,
    memory,
    memoryTrials,
  }
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function forceGC(): void {
  Bun.gc(true)
  Bun.gc(true)
}

function summarizeStatistics(statistics: Statistics, retainSamples: boolean): StatisticsSummary {
  return {
    aad: statistics.aad,
    critical: statistics.critical,
    df: statistics.df,
    mad: statistics.mad,
    max: statistics.max,
    mean: statistics.mean,
    min: statistics.min,
    moe: statistics.moe,
    p50: statistics.p50,
    p75: statistics.p75,
    p99: statistics.p99,
    p995: statistics.p995,
    p999: statistics.p999,
    rme: statistics.rme,
    samplesCount: statistics.samplesCount,
    sd: statistics.sd,
    sem: statistics.sem,
    variance: statistics.variance,
    samples: retainSamples ? statistics.samples : undefined,
  }
}

function runTinybenchAttempt(
  scenario: BenchmarkScenario,
  runtime: BenchmarkRuntime,
  options: BenchmarkOptions,
  timeMs: number,
): TinybenchAttempt {
  let attemptedOperations = 0
  let errorCount = 0
  let firstError: string | undefined
  let iteration = 0
  let mode: "warmup" | "run" = "warmup"

  const bench = new Bench({
    name: scenario.name,
    time: timeMs,
    iterations: options.iterations,
    warmup: options.warmup,
    warmupTime: options.warmupTimeMs,
    warmupIterations: options.warmupIterations,
    throws: true,
    retainSamples: options.retainSamples,
    concurrency: null,
    timestampProvider: "bunNanoseconds",
    setup: (_task, nextMode) => {
      mode = nextMode ?? "run"
      if (mode === "run") iteration = 0
    },
  })

  bench.add(
    scenario.name,
    () => {
      if (mode === "run") attemptedOperations += 1
      try {
        runtime.run(iteration)
        iteration += 1
      } catch (error) {
        if (mode === "run") errorCount += 1
        firstError ??= `${mode}: ${errorMessage(error)}`
        throw error
      }
    },
    { async: false },
  )

  try {
    bench.runSync()
  } catch (error) {
    firstError ??= errorMessage(error)
  }

  return { task: bench.tasks[0]!, attemptedOperations, errorCount, firstError, timeMs }
}

function resultFromAttempt(
  scenario: BenchmarkScenario,
  runtime: BenchmarkRuntime,
  attempt: TinybenchAttempt,
  attempts: number,
  options: BenchmarkOptions,
): BenchmarkResult {
  const taskResult = attempt.task.result
  const workPerOperation = runtime.workPerOperation ?? 1
  const bytesPerOperation = runtime.bytesPerOperation ?? 0
  const errorRatePercent =
    attempt.attemptedOperations > 0 ? (attempt.errorCount * 100) / attempt.attemptedOperations : 0

  if (taskResult.state !== "completed") {
    return {
      name: scenario.name,
      description: scenario.description,
      category: scenario.category,
      source: scenario.source,
      tier: scenario.tier,
      state: "errored",
      attempts,
      timeMs: attempt.timeMs,
      warmupTimeMs: options.warmupTimeMs,
      operations: attempt.task.runs,
      attemptedOperations: attempt.attemptedOperations,
      workPerOperation,
      workLabel: runtime.workLabel ?? "operations",
      bytesPerOperation,
      errorCount: attempt.errorCount,
      errorRatePercent,
      stable: false,
      firstError:
        attempt.firstError ?? (taskResult.state === "errored" ? errorMessage(taskResult.error) : taskResult.state),
      runtime: taskResult.runtime,
      runtimeVersion: taskResult.runtimeVersion,
      timestampProviderName: String(taskResult.timestampProviderName),
    }
  }

  const latency = summarizeStatistics(taskResult.latency, options.retainSamples)
  const throughput = summarizeStatistics(taskResult.throughput, options.retainSamples)
  const medianNsPerOperation = latency.p50 * 1_000_000
  const medianOpsPerSecond = throughput.p50
  return {
    name: scenario.name,
    description: scenario.description,
    category: scenario.category,
    source: scenario.source,
    tier: scenario.tier,
    state: "completed",
    attempts,
    timeMs: attempt.timeMs,
    warmupTimeMs: options.warmupTimeMs,
    operations: attempt.task.runs,
    attemptedOperations: attempt.attemptedOperations,
    workPerOperation,
    workLabel: runtime.workLabel ?? "operations",
    bytesPerOperation,
    latency,
    throughput,
    periodMs: taskResult.period,
    totalTimeMs: taskResult.totalTime,
    medianNsPerOperation,
    p99NsPerOperation: latency.p99 * 1_000_000,
    medianNsPerWorkItem: medianNsPerOperation / workPerOperation,
    medianWorkPerSecond: medianOpsPerSecond * workPerOperation,
    medianMiBPerSecond: bytesPerOperation > 0 ? (medianOpsPerSecond * bytesPerOperation) / (1024 * 1024) : null,
    errorCount: attempt.errorCount,
    errorRatePercent,
    stable: attempt.errorCount === 0 && latency.rme <= options.maxRmePercent,
    firstError: attempt.firstError,
    runtime: taskResult.runtime,
    runtimeVersion: taskResult.runtimeVersion,
    timestampProviderName: String(taskResult.timestampProviderName),
  }
}

function runScenario(scenario: BenchmarkScenario, options: BenchmarkOptions): BenchmarkResult {
  let result: BenchmarkResult | undefined
  let timeMs = options.timeMs
  benchmarkMarker.checksum = (benchmarkMarker.checksum + scenario.name.length) >>> 0

  for (let attemptNumber = 1; attemptNumber <= options.maxAttempts; attemptNumber += 1) {
    const runtime = scenario.setup()
    try {
      runtime.validate()
      forceGC()
      const attempt = runTinybenchAttempt(scenario, runtime, options, timeMs)
      result = resultFromAttempt(scenario, runtime, attempt, attemptNumber, options)
      if (result.state === "errored" || result.errorCount > 0 || result.stable || !options.strictRme) break
      timeMs *= 2
    } finally {
      runtime.cleanup?.()
    }
  }
  return result!
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
    for (let index = 0; index < Math.min(100, iterations); index += 1) runtime.run(index)

    for (let trial = 0; trial < options.memoryTrials; trial += 1) {
      forceGC()
      const controlBefore = process.memoryUsage()
      let control: unknown[] | undefined = new Array(iterations).fill(benchmarkMarker)
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
      samples.push({ iterations, retainedPerOperation: divideDelta(retained, iterations), residual, errors })
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
    `bun-ffi-structs engine=tinybench@${TINYBENCH_VERSION} profile=${options.profile} time_ms=${options.timeMs} warmup_ms=${options.warmup ? options.warmupTimeMs : 0} max_rme=${options.maxRmePercent}% scenarios=${results.length} checksum=${benchmarkMarker.checksum}`,
  )
  console.log("")
  printTable(
    [
      "scenario",
      "source",
      "samples",
      "median ns/op",
      "ns/item",
      "p99 ns/op",
      "mean rme %",
      "error %",
      "work/s",
      "MiB/s",
    ],
    results.map((result) => [
      result.name,
      result.source,
      String(result.latency?.samplesCount ?? 0),
      result.medianNsPerOperation === undefined ? "-" : formatNumber(result.medianNsPerOperation),
      result.medianNsPerWorkItem === undefined ? "-" : formatNumber(result.medianNsPerWorkItem),
      result.p99NsPerOperation === undefined ? "-" : formatNumber(result.p99NsPerOperation),
      result.latency === undefined ? "-" : formatNumber(result.latency.rme),
      formatNumber(result.errorRatePercent),
      result.medianWorkPerSecond === undefined ? "-" : formatNumber(result.medianWorkPerSecond),
      result.medianMiBPerSecond == null ? "-" : formatNumber(result.medianMiBPerSecond),
    ]),
  )

  if (options.verbose) {
    console.log("")
    for (const result of results) {
      console.log(
        `${result.name}: ${result.description}\n  state=${result.state} attempts=${result.attempts} operations=${result.operations} attempted=${result.attemptedOperations} latency_mean_ns=${formatNumber((result.latency?.mean ?? 0) * 1_000_000)} latency_sd_ns=${formatNumber((result.latency?.sd ?? 0) * 1_000_000)} latency_sem_ns=${formatNumber((result.latency?.sem ?? 0) * 1_000_000)} moe_ns=${formatNumber((result.latency?.moe ?? 0) * 1_000_000)} critical=${formatNumber(result.latency?.critical ?? 0)}${result.firstError ? ` error=${result.firstError}` : ""}`,
      )
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
          engine: `tinybench@${TINYBENCH_VERSION}`,
          cwd: process.cwd(),
          args: options.rawArgs,
          profile: options.profile,
          timeMs: options.timeMs,
          iterations: options.iterations,
          warmup: options.warmup,
          warmupTimeMs: options.warmupTimeMs,
          warmupIterations: options.warmupIterations,
          maxRmePercent: options.maxRmePercent,
          maxAttempts: options.maxAttempts,
          strictRme: options.strictRme,
          retainSamples: options.retainSamples,
          statisticsUnits: {
            latency: "milliseconds",
            throughput: "operations/second",
            derivedLatency: "nanoseconds",
          },
          runtime: {
            bun: Bun.version,
            node: process.versions.node,
            v8: process.versions.v8,
            platform: process.platform,
            arch: process.arch,
          },
          cpu: { model: cpu?.model, speedMHz: cpu?.speed, logicalCpus: cpus().length },
          commit: process.env.GITHUB_SHA ?? process.env.BENCH_COMMIT,
          scenarioChecksum: benchmarkMarker.checksum,
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
  benchmarkMarker.checksum = 0
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
        result.state === "completed"
          ? `${formatNumber(result.medianNsPerOperation!)} ns/op rme=${formatNumber(result.latency!.rme)}% errors=${result.errorCount}`
          : `errored error_rate=${formatNumber(result.errorRatePercent)}% ${result.firstError ?? ""}`,
      )
    }
  }

  if (options.output) printResults(results, options)
  const memoryResults = options.memory ? selected.map((scenario) => runMemoryScenario(scenario, options)) : []
  if (options.output && memoryResults.length > 0) printMemoryResults(memoryResults)
  if (options.jsonPath) writeJson(options.jsonPath, options, results, memoryResults)

  const failed = results.filter((result) => result.errorCount > 0 || result.state === "errored")
  const unstable = results.filter((result) => result.state === "completed" && result.errorCount === 0 && !result.stable)
  const memoryFailed = memoryResults.filter((result) => result.errorCount > 0)
  if (failed.length > 0 || memoryFailed.length > 0) {
    throw new Error(
      `Benchmark operation errors: ${[...failed, ...memoryFailed].map((result) => result.name).join(", ")}`,
    )
  }
  if (unstable.length > 0 && options.strictRme && !options.allowUnstable) {
    throw new Error(
      `Unstable benchmark results exceeded ${options.maxRmePercent}% Tinybench latency RME after retries: ${unstable.map((result) => `${result.name} (${formatNumber(result.latency!.rme)}%)`).join(", ")}`,
    )
  }
}
