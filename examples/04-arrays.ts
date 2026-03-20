import { defineEnum, defineStruct } from "../src/structs_ffi.js"

console.log("=== Example 4: Arrays ===\n")

const ColorEnum = defineEnum({
  RED: 0,
  GREEN: 1,
  BLUE: 2,
  YELLOW: 3,
})

const PaletteStruct = defineStruct([
  ["name", "cstring"],
  ["colorCount", "u32", { lengthOf: "colors" }],
  ["colors", [ColorEnum]],
  ["valueCount", "u32", { lengthOf: "values" }],
  ["values", ["f32"]],
] as const)

const palette = {
  name: "sunset",
  colors: ["RED", "YELLOW", "BLUE"] as const,
  values: [1.0, 0.8, 0.6, 0.4, 0.2],
}

console.log("Input palette:", palette)

const packed = PaletteStruct.pack(palette)
console.log("Packed size:", packed.byteLength, "bytes")

const unpacked = PaletteStruct.unpack(packed)
console.log("Unpacked palette:")
console.log("  name:", unpacked.name)
console.log("  colorCount:", unpacked.colorCount)
console.log("  colors:", unpacked.colors)
console.log("  valueCount:", unpacked.valueCount)
console.log("  values:", unpacked.values)

console.log("\n✓ Arrays with length fields work!")
