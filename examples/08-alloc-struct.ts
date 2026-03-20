import { defineStruct, allocStruct } from "../src/structs_ffi.js"

console.log("=== Example 8: Pre-allocating Structs with Arrays ===\n")

const DataStruct = defineStruct([
  ["count", "u32", { lengthOf: "values" }],
  ["values", ["f32"]],
  ["flags", "u32"],
] as const)

console.log("Allocating struct with array of 10 floats...")
const allocated = allocStruct(DataStruct, {
  lengths: { values: 10 },
})

console.log("Main buffer size:", allocated.buffer.byteLength, "bytes")
console.log("Sub-buffer for values:", allocated.subBuffers?.values?.byteLength, "bytes")

const view = allocated.view
console.log("\nReading pre-set count field:", view.getUint32(0, true))

console.log("\nDescribe the struct layout:")
const description = DataStruct.describe()
for (const field of description) {
  console.log(`  ${field.name}: offset=${field.offset}, size=${field.size}, align=${field.align}`)
}

console.log("\n✓ Pre-allocation helps when working with FFI buffers!")
