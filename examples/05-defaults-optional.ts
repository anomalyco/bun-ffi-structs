import { defineStruct } from "../src/structs_ffi.js"

console.log("=== Example 5: Optional Fields and Defaults ===\n")

const ConfigStruct = defineStruct([
  ["id", "u32"],
  ["timeout", "u32", { default: 5000 }],
  ["retries", "u32", { default: 3 }],
  ["verbose", "bool_u32", { default: false }],
  ["maxSize", "u32", { optional: true }],
] as const)

console.log("Example 1: Only required fields")
const config1 = { id: 1 }
console.log("Input:", config1)
const packed1 = ConfigStruct.pack(config1)
const unpacked1 = ConfigStruct.unpack(packed1)
console.log("Unpacked:", unpacked1)

console.log("\nExample 2: Override some defaults")
const config2 = { id: 2, timeout: 10000, verbose: true }
console.log("Input:", config2)
const packed2 = ConfigStruct.pack(config2)
const unpacked2 = ConfigStruct.unpack(packed2)
console.log("Unpacked:", unpacked2)

console.log("\nExample 3: With optional field")
const config3 = { id: 3, maxSize: 1024 }
console.log("Input:", config3)
const packed3 = ConfigStruct.pack(config3)
const unpacked3 = ConfigStruct.unpack(packed3)
console.log("Unpacked:", unpacked3)

console.log("\n✓ Defaults and optional fields work as expected!")
