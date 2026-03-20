import { defineStruct, objectPtr } from "../src/structs_ffi.js"

console.log("=== Example 12: Arrays of Object Pointers ===\n")

interface GPUTextureLike {
  ptr: number | bigint
}

const RenderPassDescriptor = defineStruct([
  ["attachmentCount", "u32", { lengthOf: "attachments" }],
  ["attachments", [objectPtr<GPUTextureLike>()]],
] as const)

const texture1: GPUTextureLike = { ptr: 0x1000n }
const texture2: GPUTextureLike = { ptr: 0x2000n }
const texture3: GPUTextureLike = { ptr: 0x3000n }

const descriptor = {
  attachments: [texture1, texture2, texture3],
}

console.log("Input descriptor with 3 textures")

const packed = RenderPassDescriptor.pack(descriptor)
console.log("Packed size:", packed.byteLength, "bytes")

const view = new DataView(packed)
const count = view.getUint32(0, true)
const arrayPtr = view.getBigUint64(8, true)

console.log("\nPacked main struct:")
console.log("  attachmentCount:", count)
console.log("  attachments ptr:", `0x${arrayPtr.toString(16)}`)

console.log("\n✓ Arrays of object pointers pack into pointer arrays!")
