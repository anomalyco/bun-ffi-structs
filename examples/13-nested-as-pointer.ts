import { defineStruct } from "../src/structs_ffi.js"

console.log("=== Example 13: Nested Structs as Pointers ===\n")

const LimitsStruct = defineStruct([
  ["maxTextureSize", "u32"],
  ["maxBufferSize", "u64"],
] as const)

const DeviceDescriptor = defineStruct([
  ["id", "u32"],
  ["limits", LimitsStruct, { optional: true, asPointer: true }],
  ["flags", "u32"],
] as const)

console.log("Example 1: With nested struct")
const descriptor1 = {
  id: 1,
  limits: {
    maxTextureSize: 8192,
    maxBufferSize: 1024n * 1024n * 1024n,
  },
  flags: 0x01,
}

const packed1 = DeviceDescriptor.pack(descriptor1)
console.log("Packed size:", packed1.byteLength, "bytes")

const view1 = new DataView(packed1)
const limitsPtr = view1.getBigUint64(8, true)
console.log("  limits pointer:", limitsPtr !== 0n ? "allocated" : "null")

console.log("\nExample 2: Without nested struct")
const descriptor2 = {
  id: 2,
  flags: 0x02,
}

const packed2 = DeviceDescriptor.pack(descriptor2)
const view2 = new DataView(packed2)
const limitsPtr2 = view2.getBigUint64(8, true)
console.log("  limits pointer:", limitsPtr2 !== 0n ? "allocated" : "null")

console.log("\n✓ asPointer packs nested structs as separate allocations!")
