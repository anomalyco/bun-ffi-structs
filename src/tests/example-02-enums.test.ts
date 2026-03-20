import { describe, it, expect } from "bun:test"
import { defineEnum, defineStruct } from "../structs_ffi.js"

describe("Example 2: Enums (exact reproduction)", () => {
  it("should work exactly like the example", () => {
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

    const packed = TaskStruct.pack(task)
    expect(packed.byteLength).toBeGreaterThan(0)

    const unpacked = TaskStruct.unpack(packed)

    // Verify all values match
    expect(unpacked.id).toBe(101)
    expect(unpacked.status).toBe("ACTIVE")
    expect(unpacked.priority).toBe("HIGH")
  })
})
