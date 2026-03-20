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

await bench.run()

console.table(bench.table())
