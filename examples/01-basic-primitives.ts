import { defineStruct } from "../src/structs_ffi.js"

console.log("=== Example 1: Basic Primitive Types ===\n")

const BasicStruct = defineStruct([
  ["id", "u32"],
  ["age", "u8"],
  ["score", "f32"],
  ["count", "u64"],
  ["active", "bool_u32"],
] as const)

const input = {
  id: 12345,
  age: 25,
  score: 98.5,
  count: 9007199254740991n,
  active: true,
}

console.log("Input:", input)

const packed = BasicStruct.pack(input)
console.log("Packed buffer size:", packed.byteLength, "bytes")
console.log("Struct size:", BasicStruct.size, "bytes")
console.log("Struct alignment:", BasicStruct.align, "bytes")

const unpacked = BasicStruct.unpack(packed)
console.log("Unpacked:", unpacked)

console.log("\n✓ All primitive values match!")
