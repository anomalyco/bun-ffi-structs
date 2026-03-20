import { defineStruct, objectPtr } from "../src/structs_ffi.js"

console.log("=== Example 11: Object Pointers ===\n")

interface GPUBufferLike {
  ptr: number | bigint
}

const BufferDescriptor = defineStruct([
  ["device", objectPtr<GPUBufferLike>()],
  ["size", "u64"],
  ["usage", "u32"],
] as const)

const dummyBuffer: GPUBufferLike = {
  ptr: 0x12345678n,
}

const descriptor = {
  device: dummyBuffer,
  size: 1024n,
  usage: 0x88,
}

console.log("Input descriptor:", descriptor)

const packed = BufferDescriptor.pack(descriptor)
console.log("Packed size:", packed.byteLength, "bytes")

const view = new DataView(packed)
const devicePtr = view.getBigUint64(0, true)
const size = view.getBigUint64(8, true)
const usage = view.getUint32(16, true)

console.log("\nPacked values:")
console.log("  device ptr:", `0x${devicePtr.toString(16)}`)
console.log("  size:", size)
console.log("  usage:", `0x${usage.toString(16)}`)

console.log("\n✓ Object pointers pack the .ptr property!")
