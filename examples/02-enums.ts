import { defineEnum, defineStruct } from "../src/structs_ffi.js"

console.log("=== Example 2: Enums ===\n")

const StatusEnum = defineEnum({
  PENDING: 0,
  ACTIVE: 1,
  COMPLETED: 2,
  FAILED: 3,
})

const PriorityEnum = defineEnum(
  {
    LOW: 0,
    MEDIUM: 1,
    HIGH: 2,
    CRITICAL: 3,
  },
  "u8",
)

const TaskStruct = defineStruct([
  ["id", "u32"],
  ["status", StatusEnum],
  ["priority", PriorityEnum],
] as const)

const task = {
  id: 101,
  status: "ACTIVE" as const,
  priority: "HIGH" as const,
}

console.log("Input task:", task)

const packed = TaskStruct.pack(task)
console.log("Packed size:", packed.byteLength, "bytes")

const unpacked = TaskStruct.unpack(packed)
console.log("Unpacked task:", unpacked)

console.log("\n✓ Enum values preserved through pack/unpack!")
