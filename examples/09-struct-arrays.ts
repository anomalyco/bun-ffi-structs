import { defineStruct } from "../src/structs_ffi.js"

console.log("=== Example 9: Arrays of Structs ===\n")

const PointStruct = defineStruct([
  ["x", "f32"],
  ["y", "f32"],
] as const)

const PolylineStruct = defineStruct([
  ["name", "cstring"],
  ["pointCount", "u32", { lengthOf: "points" }],
  ["points", [PointStruct]],
  ["closed", "bool_u32", { default: false }],
] as const)

const polyline = {
  name: "triangle",
  points: [
    { x: 0.0, y: 0.0 },
    { x: 10.0, y: 0.0 },
    { x: 5.0, y: 8.66 },
  ],
  closed: true,
}

console.log("Input polyline:", polyline)

const packed = PolylineStruct.pack(polyline)
console.log("Packed size:", packed.byteLength, "bytes")

console.log("\n✓ Arrays of structs can be packed!")
console.log("\nLimitation: Unpacking arrays of structs is not yet implemented.")
