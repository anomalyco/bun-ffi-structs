import { Bench } from "tinybench"
import { defineStruct, defineEnum } from "../src/structs_ffi.js"

const SimpleStruct = defineStruct([
  ["id", "u32"],
  ["value", "f64"],
  ["active", "bool_u8"],
])

const MediumStruct = defineStruct([
  ["id", "u32"],
  ["x", "f32"],
  ["y", "f32"],
  ["z", "f32"],
  ["timestamp", "u64"],
  ["flags", "u32"],
  ["enabled", "bool_u32"],
  ["score", "f64"],
])

const StatusEnum = defineEnum({
  Active: 0,
  Inactive: 1,
  Pending: 2,
  Completed: 3,
})

const NestedStruct = defineStruct([
  ["inner", SimpleStruct],
  ["status", StatusEnum],
  ["count", "u32"],
])

const ComplexNestedStruct = defineStruct([
  ["header", MediumStruct],
  ["nested", NestedStruct],
  ["footer_id", "u32"],
  ["footer_value", "f64"],
])

const ArrayStruct = defineStruct([
  ["count", "u32", { lengthOf: "items" }],
  ["items", ["u32"]],
])

const LargeArrayStruct = defineStruct([
  ["id", "u32"],
  ["data_len", "u32", { lengthOf: "data" }],
  ["data", ["f32"]],
  ["indices_len", "u32", { lengthOf: "indices" }],
  ["indices", ["u32"]],
])

const MassiveNestedStruct = defineStruct([
  ["level1", ComplexNestedStruct],
  ["level2", ComplexNestedStruct],
  ["level3", ComplexNestedStruct],
  ["counter", "u64"],
  ["metadata", MediumStruct],
])

const simpleData = { id: 42, value: 3.14159, active: true }

const mediumData = {
  id: 100,
  x: 1.5,
  y: 2.5,
  z: 3.5,
  timestamp: 1234567890n,
  flags: 0xff00ff00,
  enabled: true,
  score: 99.99,
}

const nestedData = {
  inner: simpleData,
  status: "Active" as const,
  count: 10,
}

const complexNestedData = {
  header: mediumData,
  nested: nestedData,
  footer_id: 999,
  footer_value: 123.456,
}

const massiveNestedData = {
  level1: complexNestedData,
  level2: complexNestedData,
  level3: complexNestedData,
  counter: 9999999999n,
  metadata: mediumData,
}

const smallArrayData = {
  count: 10,
  items: Array.from({ length: 10 }, (_, i) => i),
}

const mediumArrayData = {
  count: 100,
  items: Array.from({ length: 100 }, (_, i) => i),
}

const largeArrayData = {
  count: 1000,
  items: Array.from({ length: 1000 }, (_, i) => i),
}

const hugeArrayData = {
  count: 10000,
  items: Array.from({ length: 10000 }, (_, i) => i),
}

const largeArrayStructData = {
  id: 42,
  data_len: 1000,
  data: Array.from({ length: 1000 }, (_, i) => i * 0.5),
  indices_len: 500,
  indices: Array.from({ length: 500 }, (_, i) => i * 2),
}

const hugeArrayStructData = {
  id: 42,
  data_len: 10000,
  data: Array.from({ length: 10000 }, (_, i) => i * 0.5),
  indices_len: 5000,
  indices: Array.from({ length: 5000 }, (_, i) => i * 2),
}

const simpleListSmall = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  value: i * 1.5,
  active: i % 2 === 0,
}))

const simpleListMedium = Array.from({ length: 100 }, (_, i) => ({
  id: i,
  value: i * 1.5,
  active: i % 2 === 0,
}))

const simpleListLarge = Array.from({ length: 1000 }, (_, i) => ({
  id: i,
  value: i * 1.5,
  active: i % 2 === 0,
}))

const simpleListHuge = Array.from({ length: 10000 }, (_, i) => ({
  id: i,
  value: i * 1.5,
  active: i % 2 === 0,
}))

const mediumListSmall = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  x: i * 1.0,
  y: i * 2.0,
  z: i * 3.0,
  timestamp: BigInt(i * 1000),
  flags: i,
  enabled: i % 2 === 0,
  score: i * 10.5,
}))

const mediumListLarge = Array.from({ length: 1000 }, (_, i) => ({
  id: i,
  x: i * 1.0,
  y: i * 2.0,
  z: i * 3.0,
  timestamp: BigInt(i * 1000),
  flags: i,
  enabled: i % 2 === 0,
  score: i * 10.5,
}))

const complexListSmall = Array.from({ length: 10 }, () => complexNestedData)
const complexListLarge = Array.from({ length: 100 }, () => complexNestedData)

const bench = new Bench({ time: 100, iterations: 10 })

type MemoryTask = {
  name: string
  iterations: number
  run: () => unknown
}

type MemoryDelta = {
  rss: number
  heapTotal: number
  heapUsed: number
  external: number
  arrayBuffers: number
}

const memoryTasks: MemoryTask[] = [
  {
    name: "SimpleStruct pack",
    iterations: 50_000,
    run: () => SimpleStruct.pack(simpleData),
  },
  {
    name: "SimpleStruct unpack",
    iterations: 50_000,
    run: () => {
      const buf = SimpleStruct.pack(simpleData)
      return SimpleStruct.unpack(buf)
    },
  },
  {
    name: "MediumStruct pack",
    iterations: 50_000,
    run: () => MediumStruct.pack(mediumData),
  },
  {
    name: "MediumStruct unpack",
    iterations: 50_000,
    run: () => {
      const buf = MediumStruct.pack(mediumData)
      return MediumStruct.unpack(buf)
    },
  },
  {
    name: "NestedStruct pack",
    iterations: 25_000,
    run: () => NestedStruct.pack(nestedData),
  },
  {
    name: "NestedStruct unpack",
    iterations: 25_000,
    run: () => {
      const buf = NestedStruct.pack(nestedData)
      return NestedStruct.unpack(buf)
    },
  },
  {
    name: "ComplexNestedStruct pack",
    iterations: 20_000,
    run: () => ComplexNestedStruct.pack(complexNestedData),
  },
  {
    name: "ComplexNestedStruct unpack",
    iterations: 20_000,
    run: () => {
      const buf = ComplexNestedStruct.pack(complexNestedData)
      return ComplexNestedStruct.unpack(buf)
    },
  },
  {
    name: "MassiveNestedStruct pack",
    iterations: 10_000,
    run: () => MassiveNestedStruct.pack(massiveNestedData),
  },
  {
    name: "MassiveNestedStruct unpack",
    iterations: 10_000,
    run: () => {
      const buf = MassiveNestedStruct.pack(massiveNestedData)
      return MassiveNestedStruct.unpack(buf)
    },
  },
  {
    name: "ArrayStruct pack (10 items)",
    iterations: 20_000,
    run: () => ArrayStruct.pack(smallArrayData),
  },
  {
    name: "ArrayStruct pack (100 items)",
    iterations: 10_000,
    run: () => ArrayStruct.pack(mediumArrayData),
  },
  {
    name: "ArrayStruct pack (1000 items)",
    iterations: 1_000,
    run: () => ArrayStruct.pack(largeArrayData),
  },
  {
    name: "ArrayStruct pack (10000 items)",
    iterations: 100,
    run: () => ArrayStruct.pack(hugeArrayData),
  },
  {
    name: "LargeArrayStruct pack (1000 floats + 500 indices)",
    iterations: 1_000,
    run: () => LargeArrayStruct.pack(largeArrayStructData),
  },
  {
    name: "LargeArrayStruct pack (10000 floats + 5000 indices)",
    iterations: 100,
    run: () => LargeArrayStruct.pack(hugeArrayStructData),
  },
  {
    name: "SimpleStruct packList (10 items)",
    iterations: 20_000,
    run: () => SimpleStruct.packList(simpleListSmall),
  },
  {
    name: "SimpleStruct packList (100 items)",
    iterations: 5_000,
    run: () => SimpleStruct.packList(simpleListMedium),
  },
  {
    name: "SimpleStruct packList (1000 items)",
    iterations: 500,
    run: () => SimpleStruct.packList(simpleListLarge),
  },
  {
    name: "SimpleStruct packList (10000 items)",
    iterations: 50,
    run: () => SimpleStruct.packList(simpleListHuge),
  },
  {
    name: "SimpleStruct unpackList (10 items)",
    iterations: 20_000,
    run: () => {
      const buf = SimpleStruct.packList(simpleListSmall)
      return SimpleStruct.unpackList(buf, 10)
    },
  },
  {
    name: "SimpleStruct unpackList (100 items)",
    iterations: 5_000,
    run: () => {
      const buf = SimpleStruct.packList(simpleListMedium)
      return SimpleStruct.unpackList(buf, 100)
    },
  },
  {
    name: "SimpleStruct unpackList (1000 items)",
    iterations: 500,
    run: () => {
      const buf = SimpleStruct.packList(simpleListLarge)
      return SimpleStruct.unpackList(buf, 1000)
    },
  },
  {
    name: "SimpleStruct unpackList (10000 items)",
    iterations: 50,
    run: () => {
      const buf = SimpleStruct.packList(simpleListHuge)
      return SimpleStruct.unpackList(buf, 10000)
    },
  },
  {
    name: "MediumStruct packList (10 items)",
    iterations: 20_000,
    run: () => MediumStruct.packList(mediumListSmall),
  },
  {
    name: "MediumStruct packList (1000 items)",
    iterations: 250,
    run: () => MediumStruct.packList(mediumListLarge),
  },
  {
    name: "MediumStruct unpackList (10 items)",
    iterations: 20_000,
    run: () => {
      const buf = MediumStruct.packList(mediumListSmall)
      return MediumStruct.unpackList(buf, 10)
    },
  },
  {
    name: "MediumStruct unpackList (1000 items)",
    iterations: 250,
    run: () => {
      const buf = MediumStruct.packList(mediumListLarge)
      return MediumStruct.unpackList(buf, 1000)
    },
  },
  {
    name: "ComplexNestedStruct packList (10 items)",
    iterations: 5_000,
    run: () => ComplexNestedStruct.packList(complexListSmall),
  },
  {
    name: "ComplexNestedStruct packList (100 items)",
    iterations: 500,
    run: () => ComplexNestedStruct.packList(complexListLarge),
  },
  {
    name: "ComplexNestedStruct unpackList (10 items)",
    iterations: 5_000,
    run: () => {
      const buf = ComplexNestedStruct.packList(complexListSmall)
      return ComplexNestedStruct.unpackList(buf, 10)
    },
  },
  {
    name: "ComplexNestedStruct unpackList (100 items)",
    iterations: 500,
    run: () => {
      const buf = ComplexNestedStruct.packList(complexListLarge)
      return ComplexNestedStruct.unpackList(buf, 100)
    },
  },
]

const memoryIterationsOverride = parsePositiveEnvInt("BENCH_MEMORY_ITERATIONS")
let retainedMemoryOutputs: unknown[] | undefined

function parsePositiveEnvInt(name: string): number | undefined {
  const raw = process.env[name]
  if (!raw) return undefined

  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${raw}`)
  }

  return value
}

function forceGC() {
  Bun.gc(true)
  Bun.gc(true)
}

function memoryDelta(after: NodeJS.MemoryUsage, before: NodeJS.MemoryUsage): MemoryDelta {
  return {
    rss: after.rss - before.rss,
    heapTotal: after.heapTotal - before.heapTotal,
    heapUsed: after.heapUsed - before.heapUsed,
    external: after.external - before.external,
    arrayBuffers: after.arrayBuffers - before.arrayBuffers,
  }
}

function formatBytes(bytes: number): string {
  if (Math.abs(bytes) < 0.05) return "0 B"

  const sign = bytes < 0 ? "-" : ""
  let value = Math.abs(bytes)
  const units = ["B", "KiB", "MiB", "GiB"]
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }

  if (unitIndex === 0) {
    return `${sign}${value.toFixed(1)} ${units[unitIndex]}`
  }

  return `${sign}${value < 10 ? value.toFixed(2) : value.toFixed(1)} ${units[unitIndex]}`
}

function runAndRetainTaskOutputs(task: MemoryTask, iterations: number): NodeJS.MemoryUsage {
  const retained = new Array<unknown>(iterations)

  for (let i = 0; i < iterations; i++) {
    retained[i] = task.run()
  }

  retainedMemoryOutputs = retained
  forceGC()
  if (retainedMemoryOutputs.length !== iterations) {
    throw new Error("Retained memory output count changed during measurement")
  }
  return process.memoryUsage()
}

function measureMemoryTask(task: MemoryTask) {
  const iterations = memoryIterationsOverride ?? task.iterations
  const warmupIterations = Math.min(iterations, 100)

  for (let i = 0; i < warmupIterations; i++) {
    task.run()
  }

  forceGC()
  const before = process.memoryUsage()
  const retainedUsage = runAndRetainTaskOutputs(task, iterations)
  const retainedDelta = memoryDelta(retainedUsage, before)

  retainedMemoryOutputs = undefined
  if (retainedMemoryOutputs !== undefined) {
    throw new Error("Retained memory outputs were not released before residual measurement")
  }
  forceGC()
  const releasedUsage = process.memoryUsage()
  const releasedDelta = memoryDelta(releasedUsage, before)

  return {
    name: task.name,
    iterations,
    retainedDelta,
    releasedDelta,
  }
}

function runMemoryBenchmarks() {
  const filter = process.env.BENCH_MEMORY_FILTER?.toLowerCase()
  const selectedTasks = filter ? memoryTasks.filter((task) => task.name.toLowerCase().includes(filter)) : memoryTasks

  if (selectedTasks.length === 0) {
    console.warn(`No memory benchmarks matched BENCH_MEMORY_FILTER=${process.env.BENCH_MEMORY_FILTER}`)
    return
  }

  const rows = selectedTasks.map(measureMemoryTask)

  console.log("\nMemory retained by task outputs (GC before/after, output values retained)")
  console.table(
    rows.map((row) => ({
      "Task name": row.name,
      Iterations: row.iterations,
      "HeapUsed/op": formatBytes(row.retainedDelta.heapUsed / row.iterations),
      "HeapTotal/op": formatBytes(row.retainedDelta.heapTotal / row.iterations),
      "External/op": formatBytes(row.retainedDelta.external / row.iterations),
      "ArrayBuffers/op": formatBytes(row.retainedDelta.arrayBuffers / row.iterations),
      "RSS/op": formatBytes(row.retainedDelta.rss / row.iterations),
    })),
  )

  console.log("\nMemory after dropping task outputs (total delta after GC; heap/RSS may stay reserved)")
  console.table(
    rows.map((row) => ({
      "Task name": row.name,
      "HeapUsed residual": formatBytes(row.releasedDelta.heapUsed),
      "HeapTotal residual": formatBytes(row.releasedDelta.heapTotal),
      "External residual": formatBytes(row.releasedDelta.external),
      "ArrayBuffers residual": formatBytes(row.releasedDelta.arrayBuffers),
      "RSS residual": formatBytes(row.releasedDelta.rss),
    })),
  )
}

bench
  .add("SimpleStruct pack", () => {
    SimpleStruct.pack(simpleData)
  })
  .add("SimpleStruct unpack", () => {
    const buf = SimpleStruct.pack(simpleData)
    SimpleStruct.unpack(buf)
  })
  .add("MediumStruct pack", () => {
    MediumStruct.pack(mediumData)
  })
  .add("MediumStruct unpack", () => {
    const buf = MediumStruct.pack(mediumData)
    MediumStruct.unpack(buf)
  })
  .add("NestedStruct pack", () => {
    NestedStruct.pack(nestedData)
  })
  .add("NestedStruct unpack", () => {
    const buf = NestedStruct.pack(nestedData)
    NestedStruct.unpack(buf)
  })
  .add("ComplexNestedStruct pack", () => {
    ComplexNestedStruct.pack(complexNestedData)
  })
  .add("ComplexNestedStruct unpack", () => {
    const buf = ComplexNestedStruct.pack(complexNestedData)
    ComplexNestedStruct.unpack(buf)
  })
  .add("MassiveNestedStruct pack", () => {
    MassiveNestedStruct.pack(massiveNestedData)
  })
  .add("MassiveNestedStruct unpack", () => {
    const buf = MassiveNestedStruct.pack(massiveNestedData)
    MassiveNestedStruct.unpack(buf)
  })
  .add("ArrayStruct pack (10 items)", () => {
    ArrayStruct.pack(smallArrayData)
  })
  .add("ArrayStruct pack (100 items)", () => {
    ArrayStruct.pack(mediumArrayData)
  })
  .add("ArrayStruct pack (1000 items)", () => {
    ArrayStruct.pack(largeArrayData)
  })
  .add("ArrayStruct pack (10000 items)", () => {
    ArrayStruct.pack(hugeArrayData)
  })
  .add("LargeArrayStruct pack (1000 floats + 500 indices)", () => {
    LargeArrayStruct.pack(largeArrayStructData)
  })
  .add("LargeArrayStruct pack (10000 floats + 5000 indices)", () => {
    LargeArrayStruct.pack(hugeArrayStructData)
  })
  .add("SimpleStruct packList (10 items)", () => {
    SimpleStruct.packList(simpleListSmall)
  })
  .add("SimpleStruct packList (100 items)", () => {
    SimpleStruct.packList(simpleListMedium)
  })
  .add("SimpleStruct packList (1000 items)", () => {
    SimpleStruct.packList(simpleListLarge)
  })
  .add("SimpleStruct packList (10000 items)", () => {
    SimpleStruct.packList(simpleListHuge)
  })
  .add("SimpleStruct unpackList (10 items)", () => {
    const buf = SimpleStruct.packList(simpleListSmall)
    SimpleStruct.unpackList(buf, 10)
  })
  .add("SimpleStruct unpackList (100 items)", () => {
    const buf = SimpleStruct.packList(simpleListMedium)
    SimpleStruct.unpackList(buf, 100)
  })
  .add("SimpleStruct unpackList (1000 items)", () => {
    const buf = SimpleStruct.packList(simpleListLarge)
    SimpleStruct.unpackList(buf, 1000)
  })
  .add("SimpleStruct unpackList (10000 items)", () => {
    const buf = SimpleStruct.packList(simpleListHuge)
    SimpleStruct.unpackList(buf, 10000)
  })
  .add("MediumStruct packList (10 items)", () => {
    MediumStruct.packList(mediumListSmall)
  })
  .add("MediumStruct packList (1000 items)", () => {
    MediumStruct.packList(mediumListLarge)
  })
  .add("MediumStruct unpackList (10 items)", () => {
    const buf = MediumStruct.packList(mediumListSmall)
    MediumStruct.unpackList(buf, 10)
  })
  .add("MediumStruct unpackList (1000 items)", () => {
    const buf = MediumStruct.packList(mediumListLarge)
    MediumStruct.unpackList(buf, 1000)
  })
  .add("ComplexNestedStruct packList (10 items)", () => {
    ComplexNestedStruct.packList(complexListSmall)
  })
  .add("ComplexNestedStruct packList (100 items)", () => {
    ComplexNestedStruct.packList(complexListLarge)
  })
  .add("ComplexNestedStruct unpackList (10 items)", () => {
    const buf = ComplexNestedStruct.packList(complexListSmall)
    ComplexNestedStruct.unpackList(buf, 10)
  })
  .add("ComplexNestedStruct unpackList (100 items)", () => {
    const buf = ComplexNestedStruct.packList(complexListLarge)
    ComplexNestedStruct.unpackList(buf, 100)
  })

const benchMemoryMode = (process.env.BENCH_MEMORY ?? "1").toLowerCase()

if (benchMemoryMode !== "only") {
  await bench.run()
  console.table(bench.table())
}

if (benchMemoryMode !== "0" && benchMemoryMode !== "false") {
  runMemoryBenchmarks()
}
