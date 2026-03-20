import { defineStruct } from "../src/structs_ffi.js"

console.log("=== Example 6: Pack and Unpack Transforms ===\n")

const PointStruct = defineStruct([
  ["x", "f32"],
  ["y", "f32"],
] as const)

const CircleStruct = defineStruct(
  [
    ["x", "f32"],
    ["y", "f32"],
    ["radius", "f32"],
  ] as const,
  {
    mapValue: (center: { center: { x: number; y: number }; radius: number }) => ({
      x: center.center.x,
      y: center.center.y,
      radius: center.radius,
    }),
    reduceValue: (packed: { x: number; y: number; radius: number }) => ({
      center: { x: packed.x, y: packed.y },
      radius: packed.radius,
      area: Math.PI * packed.radius * packed.radius,
    }),
  },
)

const circle = {
  center: { x: 10, y: 20 },
  radius: 5,
}

console.log("Input (nested format):", circle)

const packed = CircleStruct.pack(circle)
console.log("Packed size:", packed.byteLength, "bytes")

const unpacked = CircleStruct.unpack(packed)
console.log("Unpacked (with computed area):", unpacked)

console.log("\n✓ Transforms allow flexible data mapping!")
