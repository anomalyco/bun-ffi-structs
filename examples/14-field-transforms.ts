import { defineEnum, defineStruct } from "../src/structs_ffi.js"

console.log("=== Example 14: Field-level Transforms ===\n")

const StatusEnum = defineEnum({
  INACTIVE: 0,
  ACTIVE: 1,
  SUSPENDED: 2,
})

const UserStruct = defineStruct([
  ["id", "u32"],
  [
    "ageInMonths",
    "u16",
    {
      packTransform: (years: number) => Math.floor(years * 12),
      unpackTransform: (months: number) => months / 12,
    },
  ],
  [
    "status",
    StatusEnum,
    {
      packTransform: (val: string) => (val === "INACTIVE" ? "SUSPENDED" : val),
    },
  ],
] as const)

const user = {
  id: 101,
  ageInMonths: 25.5,
  status: "INACTIVE" as const,
}

console.log("Input (age in years):", user)

const packed = UserStruct.pack(user)
console.log("Packed size:", packed.byteLength, "bytes")

const unpacked = UserStruct.unpack(packed)
console.log("Unpacked (age in years):", unpacked)

console.log("\n✓ Field transforms allow per-field data conversion!")
