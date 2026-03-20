import { defineStruct } from "../src/structs_ffi.js"

console.log("=== Example 17: Conditional Fields ===\n")

const ENABLE_EXPERIMENTAL_FEATURES = false

const ConfigStruct = defineStruct([
  ["version", "u32"],
  ["flags", "u32"],
  [
    "experimentalFeature",
    "u32",
    {
      condition: () => ENABLE_EXPERIMENTAL_FEATURES,
      default: 0xffff,
    },
  ],
  ["timeout", "u32"],
] as const)

const config = {
  version: 1,
  flags: 0x01,
  timeout: 5000,
}

console.log("Input config:", config)
console.log("ENABLE_EXPERIMENTAL_FEATURES:", ENABLE_EXPERIMENTAL_FEATURES)

const packed = ConfigStruct.pack(config)
console.log("\nPacked size:", packed.byteLength, "bytes")

const layout = ConfigStruct.describe()
console.log("\nStruct layout:")
for (const field of layout) {
  console.log(`  ${field.name}: offset=${field.offset}, size=${field.size}`)
}

console.log("\n✓ Conditional fields are excluded from layout when condition is false!")
