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
  "1",
  "--warmup",
  "1",
  "--rounds",
  "2",
  "--min-sample-ms",
  "1",
  "--max-batch",
  "10",
  "--quiet",
]

it("benchmark harness rejects fractional count options", async () => {
  await expect(runBenchmarkSuite([], ["--rounds", "0.5"])).rejects.toThrow("--rounds must be an integer >= 2")
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
        if (calls > 3) throw new Error("measured failure")
        return calls
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

it("benchmark harness always enforces the calibrated batch cap", async () => {
  const jsonPath = join(tmpdir(), `bun-ffi-structs-benchmark-${process.pid}.json`)
  const successfulScenario: BenchmarkScenario = {
    name: "harness/batch-cap",
    description: "Synthetic harness batch cap check",
    category: "harness",
    source: "library",
    tier: "core",
    setup: () => ({ validate: () => {}, run: () => 1 }),
  }

  try {
    await runBenchmarkSuite(
      [successfulScenario],
      [...baseArgs, "--iterations", "11", "--json", jsonPath, "--overwrite"],
    )
    const payload = JSON.parse(readFileSync(jsonPath, "utf8"))
    expect(payload.results[0].batchIterations).toBeLessThanOrEqual(10)
  } finally {
    rmSync(jsonPath, { force: true })
  }
})
