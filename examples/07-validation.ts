import { defineStruct } from "../src/structs_ffi.js"

console.log("=== Example 7: Field Validation ===\n")

const UserStruct = defineStruct([
  [
    "id",
    "u32",
    {
      validate: (value, fieldName) => {
        if (value < 1) {
          throw new Error(`${fieldName} must be positive`)
        }
      },
    },
  ],
  [
    "age",
    "u8",
    {
      validate: (value, fieldName) => {
        if (value < 0 || value > 150) {
          throw new Error(`${fieldName} must be between 0 and 150`)
        }
      },
    },
  ],
  [
    "email",
    "cstring",
    {
      validate: (value, fieldName) => {
        if (!value.includes("@")) {
          throw new Error(`${fieldName} must be a valid email`)
        }
      },
    },
  ],
] as const)

console.log("Valid user:")
const validUser = { id: 123, age: 30, email: "user@example.com" }
console.log("Input:", validUser)
try {
  const packed = UserStruct.pack(validUser)
  console.log("✓ Validation passed, packed successfully")
} catch (e) {
  console.error("✗ Validation failed:", (e as Error).message)
}

console.log("\nInvalid user (bad id):")
const invalidUser1 = { id: 0, age: 30, email: "user@example.com" }
console.log("Input:", invalidUser1)
try {
  UserStruct.pack(invalidUser1)
  console.log("✗ Should have failed validation!")
} catch (e) {
  console.log("✓ Validation correctly rejected:", (e as Error).message)
}

console.log("\nInvalid user (bad email):")
const invalidUser2 = { id: 123, age: 30, email: "notanemail" }
console.log("Input:", invalidUser2)
try {
  UserStruct.pack(invalidUser2)
  console.log("✗ Should have failed validation!")
} catch (e) {
  console.log("✓ Validation correctly rejected:", (e as Error).message)
}
