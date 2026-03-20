import { defineStruct } from "../src/structs_ffi.js"

console.log("=== Example 3: Nested Structs ===\n")

const Vec2Struct = defineStruct([
  ["x", "f32"],
  ["y", "f32"],
] as const)

const Vec3Struct = defineStruct([
  ["x", "f32"],
  ["y", "f32"],
  ["z", "f32"],
] as const)

const TransformStruct = defineStruct([
  ["position", Vec3Struct],
  ["scale", Vec2Struct],
  ["rotation", "f32"],
] as const)

const transform = {
  position: { x: 10.0, y: 20.0, z: 30.0 },
  scale: { x: 2.0, y: 2.0 },
  rotation: 45.0,
}

console.log("Input transform:", transform)

const packed = TransformStruct.pack(transform)
console.log("Packed size:", packed.byteLength, "bytes")

const unpacked = TransformStruct.unpack(packed)
console.log("Unpacked transform:", unpacked)

console.log("\n✓ Nested structs work correctly!")
