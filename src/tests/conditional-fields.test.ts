import { expect, describe, it } from "bun:test"
import { defineEnum, defineStruct } from "../structs_ffi.js"

describe("conditional fields", () => {
  it("should include field when condition returns true", () => {
    const TestStruct = defineStruct([
      ["field1", "u32"],
      ["conditionalField", "u32", { condition: () => true, default: 42 }],
      ["field2", "u32"],
    ] as const)

    // Field should be included in layout
    const layout = TestStruct.describe()
    expect(layout).toHaveLength(3)

    const conditionalField = layout.find((f) => f.name === "conditionalField")
    expect(conditionalField).toBeDefined()
    expect(conditionalField?.size).toBe(4)

    // Struct size should include the conditional field
    expect(TestStruct.size).toBe(12) // 3 * u32 = 12 bytes

    // Packing should work with the field included
    const packed = TestStruct.pack({ field1: 1, field2: 3 })
    const unpacked = TestStruct.unpack(packed)

    expect(unpacked.field1).toBe(1)
    expect(unpacked.conditionalField).toBe(42) // default value
    expect(unpacked.field2).toBe(3)
  })

  it("should exclude field when condition returns false", () => {
    const TestStruct = defineStruct([
      ["field1", "u32"],
      ["excludedField", "u32", { condition: () => false, default: 42 }],
      ["field2", "u32"],
    ] as const)

    // Field should NOT be included in layout
    const layout = TestStruct.describe()
    expect(layout).toHaveLength(2)

    const excludedField = layout.find((f) => f.name === "excludedField")
    expect(excludedField).toBeUndefined()

    // Struct size should NOT include the excluded field
    expect(TestStruct.size).toBe(8) // 2 * u32 = 8 bytes (not 12)

    // Packing should work without the excluded field
    const packed = TestStruct.pack({ field1: 1, field2: 3 })
    const unpacked = TestStruct.unpack(packed)

    expect(unpacked.field1).toBe(1)
    expect(unpacked.field2).toBe(3)
    expect((unpacked as any).excludedField).toBeUndefined() // Field should not exist
  })

  it("should handle conditional fields affecting alignment", () => {
    // Test alignment changes when conditional fields are excluded
    const TestStructWithAlignment = defineStruct([
      ["smallField", "u8"],
      ["alignmentField", "u64", { condition: () => false }], // This would force alignment
      ["normalField", "u32"],
    ] as const)

    const TestStructWithoutAlignment = defineStruct([
      ["smallField", "u8"],
      ["normalField", "u32"],
    ] as const)

    // Both structs should have the same layout when the alignment field is excluded
    expect(TestStructWithAlignment.size).toBe(TestStructWithoutAlignment.size)
    expect(TestStructWithAlignment.describe()).toEqual(TestStructWithoutAlignment.describe())
  })

  it("should handle nested structs with conditional fields", () => {
    const InnerStruct = defineStruct([
      ["value", "u32"],
      ["conditionalInner", "u32", { condition: () => true, default: 99 }],
    ] as const)

    const OuterStruct = defineStruct([
      ["prefix", "u32"],
      ["inner", InnerStruct],
      ["conditionalOuter", "u32", { condition: () => false, default: 88 }],
      ["suffix", "u32"],
    ] as const)

    // Verify layout
    const layout = OuterStruct.describe()
    expect(layout).toHaveLength(3) // prefix, inner, suffix (conditionalOuter excluded)

    const conditionalOuter = layout.find((f) => f.name === "conditionalOuter")
    expect(conditionalOuter).toBeUndefined()

    // Inner struct should still have its conditional field
    expect(InnerStruct.size).toBe(8) // 2 * u32

    // Pack and verify
    const input = {
      prefix: 1,
      inner: { value: 10 },
      suffix: 3,
    }

    const packed = OuterStruct.pack(input)
    const unpacked = OuterStruct.unpack(packed)

    expect(unpacked.prefix).toBe(1)
    expect(unpacked.inner.value).toBe(10)
    expect(unpacked.inner.conditionalInner).toBe(99) // default from inner struct
    expect(unpacked.suffix).toBe(3)
    expect((unpacked as any).conditionalOuter).toBeUndefined()
  })

  it("should handle arrays with conditional length fields", () => {
    const TestEnum = defineEnum({
      VALUE_A: 0,
      VALUE_B: 1,
      VALUE_C: 2,
    })

    const TestStruct = defineStruct([
      ["normalCount", "u32", { lengthOf: "normalArray" }],
      ["normalArray", [TestEnum]],
      ["conditionalCount", "u32", { condition: () => false, lengthOf: "conditionalArray" }],
      ["conditionalArray", [TestEnum], { condition: () => false }],
      ["suffix", "u32"],
    ] as const)

    // Only fields with condition true should be in layout
    const layout = TestStruct.describe()
    expect(layout).toHaveLength(3) // normalCount, normalArray, suffix

    expect(layout.find((f) => f.name === "conditionalCount")).toBeUndefined()
    expect(layout.find((f) => f.name === "conditionalArray")).toBeUndefined()

    const input = {
      normalArray: ["VALUE_A", "VALUE_B", "VALUE_C"] as const,
      suffix: 99,
    }

    const packed = TestStruct.pack(input)
    const unpacked = TestStruct.unpack(packed)

    expect(unpacked.normalCount).toBe(3)
    expect(unpacked.normalArray).toEqual(["VALUE_A", "VALUE_B", "VALUE_C"])
    expect(unpacked.suffix).toBe(99)
    expect((unpacked as any).conditionalCount).toBeUndefined()
    expect((unpacked as any).conditionalArray).toBeUndefined()
  })

  it("should handle real-world platform-specific field (like _alignment0)", () => {
    // Simulate the actual WGPUBindGroupLayoutEntryStruct behavior
    let simulatedPlatform = "linux"

    const PlatformStruct = defineStruct([
      ["binding", "u32"],
      ["visibility", "u64"],
      [
        "_alignment0",
        "u64",
        {
          default: 0,
          condition: () => simulatedPlatform === "linux",
        },
      ],
      ["buffer", "u32", { optional: true, default: 1 }],
    ] as const)

    // On Linux - field should be included
    const linuxLayout = PlatformStruct.describe()
    expect(linuxLayout).toHaveLength(4)
    expect(linuxLayout.find((f) => f.name === "_alignment0")).toBeDefined()

    const linuxSize = PlatformStruct.size

    // Test packing on Linux
    const linuxPacked = PlatformStruct.pack({ binding: 0, visibility: 4n })
    const linuxUnpacked = PlatformStruct.unpack(linuxPacked)
    expect(linuxUnpacked._alignment0).toBe(0n)

    // Now simulate non-Linux platform
    simulatedPlatform = "darwin"

    const NonLinuxStruct = defineStruct([
      ["binding", "u32"],
      ["visibility", "u64"],
      [
        "_alignment0",
        "u64",
        {
          default: 0,
          condition: () => simulatedPlatform === "linux",
        },
      ],
      ["buffer", "u32", { optional: true, default: 1 }],
    ] as const)

    // On non-Linux - field should be excluded
    const nonLinuxLayout = NonLinuxStruct.describe()
    expect(nonLinuxLayout).toHaveLength(3)
    expect(nonLinuxLayout.find((f) => f.name === "_alignment0")).toBeUndefined()

    const nonLinuxSize = NonLinuxStruct.size
    expect(nonLinuxSize).toBeLessThan(linuxSize) // Should be smaller without alignment field

    // Test packing on non-Linux
    const nonLinuxPacked = NonLinuxStruct.pack({ binding: 0, visibility: 4n })
    const nonLinuxUnpacked = NonLinuxStruct.unpack(nonLinuxPacked)
    expect((nonLinuxUnpacked as any)._alignment0).toBeUndefined()
  })

  it("should evaluate condition only once at definition time", () => {
    let conditionCallCount = 0

    const TestStruct = defineStruct([
      ["field1", "u32"],
      [
        "conditionalField",
        "u32",
        {
          condition: () => {
            conditionCallCount++
            return true
          },
          default: 42,
        },
      ],
    ] as const)

    // Condition should have been called once during definition
    expect(conditionCallCount).toBe(1)

    // Multiple pack operations should not call condition again
    TestStruct.pack({ field1: 1 })
    TestStruct.pack({ field1: 2 })
    TestStruct.pack({ field1: 3 })

    expect(conditionCallCount).toBe(1) // Still only called once

    // Unpack operations should not call condition
    const packed = TestStruct.pack({ field1: 1 })
    TestStruct.unpack(packed)
    TestStruct.unpack(packed)

    expect(conditionCallCount).toBe(1) // Still only called once
  })

  it("should handle multiple conditional fields with different conditions", () => {
    const TestStruct = defineStruct([
      ["alwaysField", "u32"],
      ["trueConditionField", "u32", { condition: () => true, default: 1 }],
      ["falseConditionField", "u32", { condition: () => false, default: 2 }],
      [
        "complexConditionField",
        "u32",
        {
          condition: () => process.env.NODE_ENV !== "test",
          default: 3,
        },
      ],
    ] as const)

    const layout = TestStruct.describe()

    // Should include alwaysField and trueConditionField
    expect(layout.find((f) => f.name === "alwaysField")).toBeDefined()
    expect(layout.find((f) => f.name === "trueConditionField")).toBeDefined()

    // Should exclude falseConditionField
    expect(layout.find((f) => f.name === "falseConditionField")).toBeUndefined()

    // complexConditionField depends on NODE_ENV (likely excluded in test environment)
    const complexField = layout.find((f) => f.name === "complexConditionField")
    if (process.env.NODE_ENV === "test") {
      expect(complexField).toBeUndefined()
    } else {
      expect(complexField).toBeDefined()
    }

    const packed = TestStruct.pack({ alwaysField: 10 })
    const unpacked = TestStruct.unpack(packed)

    expect(unpacked.alwaysField).toBe(10)
    expect(unpacked.trueConditionField).toBe(1)
    expect((unpacked as any).falseConditionField).toBeUndefined()
  })
})
