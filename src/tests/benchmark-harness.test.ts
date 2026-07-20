import { expect, it } from "bun:test"
import { readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runBenchmarkSuite, type BenchmarkScenario } from "../../bench/harness.js"
import { scenarios } from "../../bench/structs.bench.js"

const baseArgs = [
  "--profile",
  "quick",
  "--iterations",
  "2",
  "--time",
  "1",
  "--max-attempts",
  "1",
  "--no-warmup",
  "--quiet",
]

it("benchmark harness rejects fractional count options", async () => {
  await expect(runBenchmarkSuite([], ["--iterations", "0.5"])).rejects.toThrow("--iterations must be an integer >= 2")
})

it("benchmark harness preserves measured operation errors", async () => {
  let calls = 0
  const failingScenario: BenchmarkScenario = {
    name: "harness/error-accounting",
    description: "Synthetic harness error accounting check",
    category: "harness",
    source: "library",
    tier: "core",
    setup: () => ({
      validate: () => {},
      run: () => {
        calls += 1
        throw new Error("measured failure")
      },
    }),
  }

  await expect(runBenchmarkSuite([failingScenario], baseArgs)).rejects.toThrow(
    "Benchmark operation errors: harness/error-accounting",
  )
})

it("benchmark scenario names are unique and every correctness preflight passes", () => {
  expect(scenarios.length).toBeGreaterThan(60)
  expect(new Set(scenarios.map((scenario) => scenario.name)).size).toBe(scenarios.length)
  expect(scenarios.filter((scenario) => scenario.source === "legacy")).toHaveLength(45)
  expect(scenarios.filter((scenario) => scenario.source === "bun-webgpu")).toHaveLength(5)

  for (const benchmark of scenarios) {
    const runtime = benchmark.setup()
    try {
      runtime.validate()
    } finally {
      runtime.cleanup?.()
    }
  }
})

it("benchmark harness rejects unknown exact scenarios", async () => {
  await expect(
    runBenchmarkSuite([scenarios[0]!], [...baseArgs, "--scenario", `${scenarios[0]!.name},missing/scenario`]),
  ).rejects.toThrow("Unknown benchmark scenarios: missing/scenario")
})

it("benchmark harness reports Tinybench statistics and runtime-selected timestamp provider", async () => {
  const jsonPath = join(tmpdir(), `bun-ffi-structs-benchmark-${process.pid}.json`)
  const successfulScenario: BenchmarkScenario = {
    name: "harness/tinybench-statistics",
    description: "Synthetic Tinybench result check",
    category: "harness",
    source: "library",
    tier: "core",
    setup: () => ({ validate: () => {}, run: () => ({ overriddenDuration: 123 }) }),
  }

  try {
    await runBenchmarkSuite([successfulScenario], [...baseArgs, "--iterations", "2", "--json", jsonPath, "--overwrite"])
    const payload = JSON.parse(readFileSync(jsonPath, "utf8"))
    expect(payload.meta.engine).toBe("tinybench@6.0.2")
    expect(payload.results[0].state).toBe("completed")
    expect(payload.results[0].latency.samplesCount).toBeGreaterThanOrEqual(2)
    expect(payload.results[0].latency.p50).toBeLessThan(1)
    expect(payload.results[0].timestampProviderName).toBe("bunNanoseconds")
  } finally {
    rmSync(jsonPath, { force: true })
  }
})

it("benchmark harness excludes Tinybench warmup from measured operation counts", async () => {
  const jsonPath = join(tmpdir(), `bun-ffi-structs-benchmark-warmup-${process.pid}.json`)
  const successfulScenario: BenchmarkScenario = {
    name: "harness/warmup-accounting",
    description: "Synthetic Tinybench warmup accounting check",
    category: "harness",
    source: "library",
    tier: "core",
    setup: () => ({ validate: () => {}, run: () => 1 }),
  }

  try {
    await runBenchmarkSuite(
      [successfulScenario],
      [
        "--profile",
        "quick",
        "--time",
        "1",
        "--iterations",
        "2",
        "--warmup-time",
        "1",
        "--warmup-iterations",
        "2",
        "--quiet",
        "--json",
        jsonPath,
        "--overwrite",
      ],
    )
    const result = JSON.parse(readFileSync(jsonPath, "utf8")).results[0]
    expect(result.attemptedOperations).toBe(result.operations)
  } finally {
    rmSync(jsonPath, { force: true })
  }
})

it("benchmark harness does not retry or mask warmup failures in strict mode", async () => {
  let setups = 0
  const warmupFailure: BenchmarkScenario = {
    name: "harness/warmup-failure",
    description: "Synthetic Tinybench warmup failure check",
    category: "harness",
    source: "library",
    tier: "core",
    setup: () => {
      setups += 1
      const shouldFail = setups === 1
      return {
        validate: () => {},
        run: () => {
          if (shouldFail) throw new Error("warmup failure")
        },
      }
    },
  }

  await expect(
    runBenchmarkSuite(
      [warmupFailure],
      [
        "--profile",
        "quick",
        "--time",
        "1",
        "--iterations",
        "2",
        "--warmup-time",
        "1",
        "--warmup-iterations",
        "2",
        "--max-attempts",
        "2",
        "--strict-rme",
        "--quiet",
      ],
    ),
  ).rejects.toThrow("Benchmark operation errors: harness/warmup-failure")
  expect(setups).toBe(1)
})
