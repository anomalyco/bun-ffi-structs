import { defineEnum, defineStruct } from "../src/structs_ffi.js"

console.log("=== Example 10: Complex WebGPU-like Structure ===\n")

const TextureSampleType = defineEnum({
  undefined: 1,
  float: 2,
  "unfilterable-float": 3,
  depth: 4,
})

const TextureViewDimension = defineEnum({
  undefined: 0,
  "2d": 2,
  "2d-array": 3,
  cube: 4,
})

const WGPU_STRLEN = 0xffffffffffffffffn

const StringView = defineStruct(
  [
    ["data", "char*", { optional: true }],
    ["length", "u64"],
  ] as const,
  {
    mapValue: (v: string | null | undefined) => {
      if (!v) {
        return { data: null, length: WGPU_STRLEN }
      }
      return { data: v, length: Buffer.byteLength(v) }
    },
  },
)

const TextureBindingLayout = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["sampleType", TextureSampleType, { default: "float" }],
  ["viewDimension", TextureViewDimension, { default: "2d" }],
  ["multisampled", "bool_u32", { default: false }],
] as const)

const BindGroupLayoutEntry = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["binding", "u32"],
  ["visibility", "u64"],
  ["texture", TextureBindingLayout, { optional: true }],
] as const)

const BindGroupLayoutDescriptor = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["label", StringView, { optional: true }],
  ["entryCount", "u64", { lengthOf: "entries" }],
  ["entries", [BindGroupLayoutEntry]],
] as const)

const descriptor = {
  label: "my-bind-group-layout",
  entries: [
    {
      binding: 0,
      visibility: 0x4n,
      texture: {
        sampleType: "float" as const,
        viewDimension: "2d" as const,
        multisampled: false,
      },
    },
    {
      binding: 1,
      visibility: 0x4n,
      texture: {},
    },
  ],
}

console.log("Input descriptor:")
console.log(JSON.stringify(descriptor, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2))

const packed = BindGroupLayoutDescriptor.pack(descriptor)
console.log("\nPacked size:", packed.byteLength, "bytes")
console.log("✓ Successfully packed complex nested structure!")

console.log("\nVerifying packed data:")
const layout = BindGroupLayoutDescriptor.describe()
const view = new DataView(packed)

const entryCountField = layout.find((f) => f.name === "entryCount")!
const entryCount = view.getBigUint64(entryCountField.offset, true)
console.log("  Entry count:", Number(entryCount), "(expected: 2)")

const entriesField = layout.find((f) => f.name === "entries")!
const entriesPtr = view.getBigUint64(entriesField.offset, true)
console.log("  Entries pointer:", entriesPtr !== 0n ? "✓ allocated" : "✗ null")

console.log("\n✓ Complex nested structures with arrays, enums, and defaults work!")
console.log("\nLimitation: Unpacking arrays of structs is not yet implemented.")
