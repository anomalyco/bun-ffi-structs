import { defineStruct } from "../src/structs_ffi.js"

console.log("=== Example 18: Optional Pointer with Type Transforms ===\n")

class Color {
  constructor(
    public r: number,
    public g: number,
    public b: number,
  ) {}

  toRGB(): number {
    const r = Math.floor(this.r * 255) & 0xff
    const g = Math.floor(this.g * 255) & 0xff
    const b = Math.floor(this.b * 255) & 0xff
    return (r << 16) | (g << 8) | b
  }

  static fromRGB(rgb: number): Color {
    const r = ((rgb >> 16) & 0xff) / 255
    const g = ((rgb >> 8) & 0xff) / 255
    const b = (rgb & 0xff) / 255
    return new Color(r, g, b)
  }

  toString(): string {
    return `Color(r=${this.r.toFixed(2)}, g=${this.g.toFixed(2)}, b=${this.b.toFixed(2)})`
  }
}

const StyledTextStruct = defineStruct([
  ["text_length", "u32"],
  [
    "fg_color",
    "u32",
    {
      optional: true,
      packTransform: (color?: Color) => (color ? color.toRGB() : 0),
      unpackTransform: (rgb: number) => (rgb !== 0 ? Color.fromRGB(rgb) : undefined),
    },
  ],
  [
    "bg_color",
    "u32",
    {
      optional: true,
      packTransform: (color?: Color) => (color ? color.toRGB() : 0),
      unpackTransform: (rgb: number) => (rgb !== 0 ? Color.fromRGB(rgb) : undefined),
    },
  ],
  ["bold", "bool_u8"],
] as const)

const redColor = new Color(1.0, 0.0, 0.0)
const whiteColor = new Color(1.0, 1.0, 1.0)
const greenColor = new Color(0.0, 1.0, 0.0)

console.log("Example 1: Text with both foreground and background colors")
const style1 = {
  text_length: 5,
  fg_color: redColor,
  bg_color: whiteColor,
  bold: true,
}
console.log("Input:", {
  text_length: style1.text_length,
  fg_color: style1.fg_color.toString(),
  bg_color: style1.bg_color.toString(),
  bold: style1.bold,
})

const packed1 = StyledTextStruct.pack(style1)
console.log("Packed size:", packed1.byteLength, "bytes")

const view1 = new DataView(packed1)
console.log("Raw packed values:")
console.log("  text_length:", view1.getUint32(0, true))
console.log("  fg_color:", `0x${view1.getUint32(4, true).toString(16).padStart(6, "0")}`)
console.log("  bg_color:", `0x${view1.getUint32(8, true).toString(16).padStart(6, "0")}`)
console.log("  bold:", view1.getUint8(12))

const unpacked1 = StyledTextStruct.unpack(packed1)
console.log("Unpacked:", {
  text_length: unpacked1.text_length,
  fg_color: unpacked1.fg_color?.toString(),
  bg_color: unpacked1.bg_color?.toString(),
  bold: unpacked1.bold,
})

console.log("\nExample 2: Text with only foreground color")
const style2 = {
  text_length: 10,
  fg_color: greenColor,
  bold: false,
}
console.log("Input:", {
  text_length: style2.text_length,
  fg_color: style2.fg_color.toString(),
  bg_color: undefined,
  bold: style2.bold,
})

const packed2 = StyledTextStruct.pack(style2)
console.log("Packed size:", packed2.byteLength, "bytes")

const unpacked2 = StyledTextStruct.unpack(packed2)
console.log("Unpacked:", {
  text_length: unpacked2.text_length,
  fg_color: unpacked2.fg_color?.toString(),
  bg_color: unpacked2.bg_color,
  bold: unpacked2.bold,
})

console.log("\nExample 3: Text with no colors")
const style3 = {
  text_length: 1,
  bold: false,
}
console.log("Input:", style3)

const packed3 = StyledTextStruct.pack(style3)
console.log("Packed size:", packed3.byteLength, "bytes")

const unpacked3 = StyledTextStruct.unpack(packed3)
console.log("Unpacked:", {
  text_length: unpacked3.text_length,
  fg_color: unpacked3.fg_color,
  bg_color: unpacked3.bg_color,
  bold: unpacked3.bold,
})

console.log("\n✓ Optional pointer fields with type transforms work!")
