import { expect, describe, it } from "bun:test"
import { toArrayBuffer } from "bun:ffi"
import { defineEnum, defineStruct } from "../structs_ffi.js"

describe("field validation", () => {
  it("should validate primitive fields and throw on invalid values", () => {
    const TestStruct = defineStruct([
      [
        "id",
        "u32",
        {
          validate: (value, fieldName) => {
            if (typeof value !== "number" || value < 0) {
              throw new Error(`${fieldName} must be a positive number`)
            }
          },
        },
      ],
      [
        "name",
        "cstring",
        {
          validate: (value, fieldName) => {
            if (typeof value !== "string" || value.length === 0) {
              throw new Error(`${fieldName} must be a non-empty string`)
            }
          },
        },
      ],
    ] as const)

    // Valid input should work
    expect(() => {
      TestStruct.pack({ id: 42, name: "test" })
    }).not.toThrow()

    // Invalid id should throw
    expect(() => {
      TestStruct.pack({ id: -1, name: "test" })
    }).toThrow("id must be a positive number")

    // Invalid name should throw
    expect(() => {
      TestStruct.pack({ id: 42, name: "" })
    }).toThrow("name must be a non-empty string")
  })

  it("should validate enum fields", () => {
    const StatusEnum = defineEnum({
      ACTIVE: 0,
      INACTIVE: 1,
      PENDING: 2,
    })

    const TestStruct = defineStruct([
      [
        "status",
        StatusEnum,
        {
          validate: (value, fieldName) => {
            if (!["ACTIVE", "INACTIVE"].includes(value)) {
              throw new Error(`${fieldName} must be ACTIVE or INACTIVE`)
            }
          },
        },
      ],
    ] as const)

    // Valid status should work
    expect(() => {
      TestStruct.pack({ status: "ACTIVE" })
    }).not.toThrow()

    // Invalid status should throw
    expect(() => {
      TestStruct.pack({ status: "PENDING" })
    }).toThrow("status must be ACTIVE or INACTIVE")
  })

  it("should validate optional fields when present", () => {
    const TestStruct = defineStruct([
      ["required", "u32"],
      [
        "optional",
        "u32",
        {
          optional: true,
          validate: (value, fieldName) => {
            if (value !== undefined && value < 10) {
              throw new Error(`${fieldName} must be >= 10 when provided`)
            }
          },
        },
      ],
    ] as const)

    // Missing optional field should work
    expect(() => {
      TestStruct.pack({ required: 1 })
    }).not.toThrow()

    // Valid optional field should work
    expect(() => {
      TestStruct.pack({ required: 1, optional: 15 })
    }).not.toThrow()

    // Invalid optional field should throw
    expect(() => {
      TestStruct.pack({ required: 1, optional: 5 })
    }).toThrow("optional must be >= 10 when provided")
  })

  it("should validate array fields", () => {
    const TestStruct = defineStruct([
      ["count", "u32", { lengthOf: "items" }],
      [
        "items",
        ["u32"],
        {
          validate: (value, fieldName) => {
            if (!Array.isArray(value) || value.length > 5) {
              throw new Error(`${fieldName} must be an array with max 5 elements`)
            }
          },
        },
      ],
    ] as const)

    // Valid array should work
    expect(() => {
      TestStruct.pack({ items: [1, 2, 3] })
    }).not.toThrow()

    // Invalid array (too many items) should throw
    expect(() => {
      TestStruct.pack({ items: [1, 2, 3, 4, 5, 6] })
    }).toThrow("items must be an array with max 5 elements")
  })

  it("should pass validation hints to validators", () => {
    const TestStruct = defineStruct([
      [
        "value",
        "u32",
        {
          validate: (value, fieldName, { hints }) => {
            const maxValue = hints?.maxValue || 100
            if (value > maxValue) {
              throw new Error(`${fieldName} must be <= ${maxValue} (hint: ${hints?.context || "no context"})`)
            }
          },
        },
      ],
    ] as const)

    // Should work with default max
    expect(() => {
      TestStruct.pack({ value: 50 })
    }).not.toThrow()

    // Should work with custom hint
    expect(() => {
      TestStruct.pack(
        { value: 150 },
        {
          validationHints: { maxValue: 200, context: "custom limit" },
        },
      )
    }).not.toThrow()

    // Should fail with custom hint message
    expect(() => {
      TestStruct.pack(
        { value: 250 },
        {
          validationHints: { maxValue: 200, context: "custom limit" },
        },
      )
    }).toThrow("value must be <= 200 (hint: custom limit)")
  })

  it("should validate nested structs and propagate hints", () => {
    const InnerStruct = defineStruct([
      [
        "x",
        "f32",
        {
          validate: (value, fieldName, { hints }) => {
            const range = hints?.coordinateRange || [-100, 100]
            if (value < range[0] || value > range[1]) {
              throw new Error(`${fieldName} must be within range [${range[0]}, ${range[1]}]`)
            }
          },
        },
      ],
      [
        "y",
        "f32",
        {
          validate: (value, fieldName, { hints }) => {
            const range = hints?.coordinateRange || [-100, 100]
            if (value < range[0] || value > range[1]) {
              throw new Error(`${fieldName} must be within range [${range[0]}, ${range[1]}]`)
            }
          },
        },
      ],
    ] as const)

    const OuterStruct = defineStruct([
      [
        "name",
        "cstring",
        {
          validate: (value, fieldName, { hints }) => {
            const prefix = hints?.namePrefix || ""
            if (prefix && !value.startsWith(prefix)) {
              throw new Error(`${fieldName} must start with '${prefix}'`)
            }
          },
        },
      ],
      [
        "position",
        InnerStruct,
        {
          validate: (value, fieldName, { hints }) => {
            if (!value || typeof value !== "object") {
              throw new Error(`${fieldName} must be a valid position object`)
            }
          },
        },
      ],
    ] as const)

    // Valid nested struct should work
    expect(() => {
      OuterStruct.pack({
        name: "test",
        position: { x: 10, y: 20 },
      })
    }).not.toThrow()

    // Should propagate hints to nested validation
    expect(() => {
      OuterStruct.pack(
        {
          name: "prefix_test",
          position: { x: 50, y: 75 },
        },
        {
          validationHints: {
            namePrefix: "prefix_",
            coordinateRange: [-200, 200],
          },
        },
      )
    }).not.toThrow()

    // Should fail outer validation with hints
    expect(() => {
      OuterStruct.pack(
        {
          name: "wrong_test",
          position: { x: 10, y: 20 },
        },
        {
          validationHints: { namePrefix: "prefix_" },
        },
      )
    }).toThrow("name must start with 'prefix_'")

    // Should fail inner validation with propagated hints
    expect(() => {
      OuterStruct.pack(
        {
          name: "prefix_test",
          position: { x: 300, y: 20 },
        },
        {
          validationHints: {
            namePrefix: "prefix_",
            coordinateRange: [-200, 200],
          },
        },
      )
    }).toThrow("x must be within range [-200, 200]")
  })

  it("should validate multiple nested levels with hint propagation", () => {
    const Level3Struct = defineStruct([
      [
        "value",
        "u32",
        {
          validate: (value, fieldName, { hints }) => {
            const multiplier = hints?.multiplier || 1
            if (value % multiplier !== 0) {
              throw new Error(`${fieldName} must be divisible by ${multiplier}`)
            }
          },
        },
      ],
    ] as const)

    const Level2Struct = defineStruct([
      [
        "data",
        Level3Struct,
        {
          validate: (value, fieldName, { hints }) => {
            if (!value || typeof value !== "object") {
              throw new Error(`${fieldName} must be a valid data object`)
            }
          },
        },
      ],
    ] as const)

    const Level1Struct = defineStruct([
      [
        "nested",
        Level2Struct,
        {
          validate: (value, fieldName, { hints }) => {
            if (!value || typeof value !== "object") {
              throw new Error(`${fieldName} must be a valid nested object`)
            }
          },
        },
      ],
    ] as const)

    // Valid deeply nested structure
    expect(() => {
      Level1Struct.pack({
        nested: {
          data: { value: 10 },
        },
      })
    }).not.toThrow()

    // Should propagate hints through multiple levels
    expect(() => {
      Level1Struct.pack(
        {
          nested: {
            data: { value: 15 },
          },
        },
        {
          validationHints: { multiplier: 5 },
        },
      )
    }).not.toThrow()

    // Should fail validation at deepest level with propagated hints
    expect(() => {
      Level1Struct.pack(
        {
          nested: {
            data: { value: 13 },
          },
        },
        {
          validationHints: { multiplier: 5 },
        },
      )
    }).toThrow("value must be divisible by 5")
  })

  it("should validate struct arrays with hint propagation", () => {
    const ItemStruct = defineStruct([
      [
        "id",
        "u32",
        {
          validate: (value, fieldName, { hints }) => {
            const minId = hints?.minId || 0
            if (value < minId) {
              throw new Error(`${fieldName} must be >= ${minId}`)
            }
          },
        },
      ],
      ["name", "cstring"],
    ] as const)

    const ContainerStruct = defineStruct([
      ["itemCount", "u32", { lengthOf: "items" }],
      [
        "items",
        [ItemStruct],
        {
          validate: (value, fieldName, { hints }) => {
            const maxItems = hints?.maxItems || 10
            if (value.length > maxItems) {
              throw new Error(`${fieldName} cannot have more than ${maxItems} items`)
            }
          },
        },
      ],
    ] as const)

    // Valid array of structs
    expect(() => {
      ContainerStruct.pack({
        items: [
          { id: 1, name: "item1" },
          { id: 2, name: "item2" },
        ],
      })
    }).not.toThrow()

    // Should validate array size with hints
    expect(() => {
      ContainerStruct.pack(
        {
          items: [
            { id: 1, name: "item1" },
            { id: 2, name: "item2" },
            { id: 3, name: "item3" },
          ],
        },
        {
          validationHints: { maxItems: 2 },
        },
      )
    }).toThrow("items cannot have more than 2 items")

    // Should propagate hints to individual struct items
    expect(() => {
      ContainerStruct.pack(
        {
          items: [{ id: 5, name: "item1" }],
        },
        {
          validationHints: { minId: 10 },
        },
      )
    }).toThrow("id must be >= 10")
  })

  it("should validate with defaults and conditionals", () => {
    const TestStruct = defineStruct([
      ["mode", "u32", { default: 0 }],
      [
        "conditionalField",
        "u32",
        {
          condition: () => true,
          default: 5,
          validate: (value, fieldName) => {
            if (value < 5) {
              throw new Error(`${fieldName} must be >= 5`)
            }
          },
        },
      ],
      [
        "excludedField",
        "u32",
        {
          condition: () => false,
          validate: () => {
            throw new Error("This should never be called")
          },
        },
      ],
    ] as const)

    // Should validate default values
    expect(() => {
      TestStruct.pack({})
    }).not.toThrow()

    // Should validate provided values
    expect(() => {
      TestStruct.pack({ conditionalField: 3 })
    }).toThrow("conditionalField must be >= 5")

    // Excluded field validation should never run
    expect(() => {
      TestStruct.pack({ mode: 1 })
    }).not.toThrow()
  })

  it("should handle validation errors in complex real-world scenario", () => {
    const BufferLayoutStruct = defineStruct([
      [
        "type",
        "u32",
        {
          default: 2,
          validate: (value, fieldName, { hints }) => {
            const validTypes = hints?.validBufferTypes || [0, 1, 2]
            if (!validTypes.includes(value)) {
              throw new Error(`${fieldName} must be one of: ${validTypes.join(", ")}`)
            }
          },
        },
      ],
      [
        "minBindingSize",
        "u64",
        {
          default: 0,
          validate: (value, fieldName, { hints }) => {
            const maxSize = hints?.maxBufferSize || 1024 * 1024
            if (value > maxSize) {
              throw new Error(`${fieldName} cannot exceed ${maxSize} bytes`)
            }
          },
        },
      ],
    ] as const)

    const BindGroupLayoutEntryStruct = defineStruct([
      [
        "binding",
        "u32",
        {
          validate: (value, fieldName) => {
            if (value > 15) {
              throw new Error(`${fieldName} must be <= 15 (WebGPU limit)`)
            }
          },
        },
      ],
      ["visibility", "u64"],
      [
        "buffer",
        BufferLayoutStruct,
        {
          optional: true,
          validate: (value, fieldName, hints) => {
            if (value && typeof value !== "object") {
              throw new Error(`${fieldName} must be a valid buffer layout`)
            }
          },
        },
      ],
    ] as const)

    const BindGroupLayoutDescriptorStruct = defineStruct([
      ["entryCount", "u64", { lengthOf: "entries" }],
      [
        "entries",
        [BindGroupLayoutEntryStruct],
        {
          validate: (value, fieldName, { hints }) => {
            const maxEntries = hints?.maxBindings || 8
            if (value.length > maxEntries) {
              throw new Error(`${fieldName} cannot exceed ${maxEntries} bindings`)
            }
          },
        },
      ],
    ] as const)

    const validInput = {
      entries: [
        {
          binding: 0,
          visibility: 0x4n,
          buffer: { type: 2, minBindingSize: 256 },
        },
        {
          binding: 1,
          visibility: 0x4n,
          buffer: { type: 1, minBindingSize: 128 },
        },
      ],
    }

    // Valid input should work
    expect(() => {
      BindGroupLayoutDescriptorStruct.pack(validInput)
    }).not.toThrow()

    // Should fail on too many entries
    const tooManyEntries = {
      entries: Array(10)
        .fill(0)
        .map((_, i) => ({
          binding: i,
          visibility: 0x4n,
          buffer: { type: 2, minBindingSize: 0 },
        })),
    }

    expect(() => {
      BindGroupLayoutDescriptorStruct.pack(tooManyEntries, {
        validationHints: { maxBindings: 8 },
      })
    }).toThrow("entries cannot exceed 8 bindings")

    // Should fail on invalid binding number
    const invalidBinding = {
      entries: [
        {
          binding: 20,
          visibility: 0x4n,
          buffer: { type: 2, minBindingSize: 0 },
        },
      ],
    }

    expect(() => {
      BindGroupLayoutDescriptorStruct.pack(invalidBinding)
    }).toThrow("binding must be <= 15 (WebGPU limit)")

    // Should fail on invalid buffer type with hints
    const invalidBufferType = {
      entries: [
        {
          binding: 0,
          visibility: 0x4n,
          buffer: { type: 5, minBindingSize: 0 },
        },
      ],
    }

    expect(() => {
      BindGroupLayoutDescriptorStruct.pack(invalidBufferType, {
        validationHints: { validBufferTypes: [0, 1, 2] },
      })
    }).toThrow("type must be one of: 0, 1, 2")
  })

  it("should explicitly verify hints propagation with captured values", () => {
    const capturedHints: any[] = []

    const Level3Struct = defineStruct([
      [
        "deepValue",
        "u32",
        {
          validate: (value, fieldName, { hints }) => {
            capturedHints.push({ level: "level3", field: fieldName, hints: { ...hints } })
            if (hints?.enforceLevel3 && value !== 999) {
              throw new Error(`${fieldName} must be 999 when enforceLevel3 is set`)
            }
          },
        },
      ],
    ] as const)

    const Level2Struct = defineStruct([
      [
        "level3",
        Level3Struct,
        {
          validate: (value, fieldName, { hints }) => {
            capturedHints.push({ level: "level2", field: fieldName, hints: { ...hints } })
            if (hints?.enforceLevel2 && !value.deepValue) {
              throw new Error(`${fieldName} must have deepValue when enforceLevel2 is set`)
            }
          },
        },
      ],
    ] as const)

    const Level1Struct = defineStruct([
      [
        "level2",
        Level2Struct,
        {
          validate: (value, fieldName, { hints }) => {
            capturedHints.push({ level: "level1", field: fieldName, hints: { ...hints } })
            if (hints?.enforceLevel1 && !value.level3) {
              throw new Error(`${fieldName} must have level3 when enforceLevel1 is set`)
            }
          },
        },
      ],
    ] as const)

    // Clear any previous captures
    capturedHints.length = 0

    const testInput = {
      level2: {
        level3: {
          deepValue: 999,
        },
      },
    }

    const testHints = {
      enforceLevel1: true,
      enforceLevel2: true,
      enforceLevel3: true,
      sharedData: "test-data",
      numbers: [1, 2, 3],
    }

    // Pack with hints
    Level1Struct.pack(testInput, { validationHints: testHints })

    // Verify that all 3 levels received the hints
    expect(capturedHints).toHaveLength(3)

    // Check that each level received the exact same hints
    const level1Capture = capturedHints.find((c) => c.level === "level1")
    const level2Capture = capturedHints.find((c) => c.level === "level2")
    const level3Capture = capturedHints.find((c) => c.level === "level3")

    expect(level1Capture).toBeDefined()
    expect(level2Capture).toBeDefined()
    expect(level3Capture).toBeDefined()

    // All levels should have received the same hints object
    expect(level1Capture.hints).toEqual(testHints)
    expect(level2Capture.hints).toEqual(testHints)
    expect(level3Capture.hints).toEqual(testHints)

    // Verify the hints are actually the same reference (not just equal)
    expect(level1Capture.hints.sharedData).toBe("test-data")
    expect(level2Capture.hints.numbers).toEqual([1, 2, 3])
    expect(level3Capture.hints.enforceLevel3).toBe(true)

    // Clear and test with different input that should fail at level 3
    capturedHints.length = 0

    const failingInput = {
      level2: {
        level3: {
          deepValue: 123, // Should fail when enforceLevel3=true
        },
      },
    }

    expect(() => {
      Level1Struct.pack(failingInput, { validationHints: testHints })
    }).toThrow("deepValue must be 999 when enforceLevel3 is set")

    // Should still have captured hints for level1 and level2 before level3 failed
    expect(capturedHints.length).toBeGreaterThanOrEqual(2)
    const failureLevel3Capture = capturedHints.find((c) => c.level === "level3")
    expect(failureLevel3Capture).toBeDefined()
    expect(failureLevel3Capture.hints.enforceLevel3).toBe(true)
  })

  it("should propagate hints through struct arrays correctly", () => {
    const capturedArrayHints: any[] = []

    const ItemStruct = defineStruct([
      [
        "itemId",
        "u32",
        {
          validate: (value, fieldName, { hints }) => {
            capturedArrayHints.push({
              field: fieldName,
              value,
              hints: { ...hints },
              timestamp: Date.now(),
            })
            const minId = hints?.minItemId || 0
            if (value < minId) {
              throw new Error(`${fieldName} must be >= ${minId}`)
            }
          },
        },
      ],
    ] as const)

    const ArrayStruct = defineStruct([
      ["count", "u32", { lengthOf: "items" }],
      [
        "items",
        [ItemStruct],
        {
          validate: (value, fieldName, { hints }) => {
            capturedArrayHints.push({
              field: fieldName,
              arrayLength: value.length,
              hints: { ...hints },
            })
          },
        },
      ],
    ] as const)

    capturedArrayHints.length = 0

    const arrayInput = {
      items: [{ itemId: 10 }, { itemId: 20 }, { itemId: 30 }],
    }

    const arrayHints = {
      minItemId: 5,
      maxItems: 10,
      context: "array-test",
    }

    ArrayStruct.pack(arrayInput, { validationHints: arrayHints })

    // Should have captured hints for the array field plus each item
    expect(capturedArrayHints.length).toBe(4) // 1 for array + 3 for items

    // Check array-level validation received hints
    const arrayCapture = capturedArrayHints.find((c) => c.field === "items")
    expect(arrayCapture).toBeDefined()
    expect(arrayCapture.hints).toEqual(arrayHints)
    expect(arrayCapture.arrayLength).toBe(3)

    // Check each item received the same hints
    const itemCaptures = capturedArrayHints.filter((c) => c.field === "itemId")
    expect(itemCaptures).toHaveLength(3)

    for (const itemCapture of itemCaptures) {
      expect(itemCapture.hints).toEqual(arrayHints)
      expect(itemCapture.hints.minItemId).toBe(5)
      expect(itemCapture.hints.context).toBe("array-test")
    }

    // Verify individual items received different values but same hints
    expect(itemCaptures[0].value).toBe(10)
    expect(itemCaptures[1].value).toBe(20)
    expect(itemCaptures[2].value).toBe(30)

    // Test failure propagation in array items
    capturedArrayHints.length = 0

    const failingArrayInput = {
      items: [
        { itemId: 10 },
        { itemId: 2 }, // This should fail with minItemId=5
        { itemId: 30 },
      ],
    }

    expect(() => {
      ArrayStruct.pack(failingArrayInput, { validationHints: arrayHints })
    }).toThrow("itemId must be >= 5")

    // Should have captured the array validation and first item, then failed on second item
    expect(capturedArrayHints.length).toBeGreaterThanOrEqual(2)
    const failedItemCapture = capturedArrayHints.find((c) => c.field === "itemId" && c.value === 2)
    expect(failedItemCapture).toBeDefined()
    expect(failedItemCapture.hints.minItemId).toBe(5)
  })
})

describe("validation hints", () => {
  it("should propagate hints to nested structs with asPointer: true (real WGPULimits scenario)", () => {
    const capturedValidations: any[] = []

    function validateLimitField(val: number, fieldName: string, { hints }: { hints?: any } = {}) {
      capturedValidations.push({ field: fieldName, value: val, hints: { ...hints } })
    }

    // Mock DEFAULT_SUPPORTED_LIMITS
    const DEFAULT_SUPPORTED_LIMITS = {
      maxTextureDimension1D: 8192,
      maxTextureDimension2D: 8192,
      maxComputeWorkgroupsPerDimension: 65535,
    }

    // Simulate WGPULimitsStruct
    const WGPULimitsStruct = defineStruct(
      [
        ["maxTextureDimension1D", "u32", { default: DEFAULT_SUPPORTED_LIMITS.maxTextureDimension1D }],
        ["maxTextureDimension2D", "u32", { default: DEFAULT_SUPPORTED_LIMITS.maxTextureDimension2D }],
        [
          "maxComputeWorkgroupsPerDimension",
          "u32",
          {
            default: DEFAULT_SUPPORTED_LIMITS.maxComputeWorkgroupsPerDimension,
            validate: validateLimitField,
          },
        ],
      ] as const,
      {
        default: {
          ...DEFAULT_SUPPORTED_LIMITS,
        },
      },
    )

    // Simulate WGPUDeviceDescriptorStruct with asPointer: true
    const WGPUDeviceDescriptorStruct = defineStruct([
      ["label", "cstring", { optional: true }],
      ["requiredLimits", WGPULimitsStruct, { optional: true, asPointer: true }],
      ["otherField", "u32", { default: 42 }],
    ] as const)

    capturedValidations.length = 0

    // Test input similar to user's scenario
    const deviceInput = {
      label: "test-device",
      requiredLimits: {
        maxTextureDimension1D: 4096,
        maxTextureDimension2D: 4096,
        maxComputeWorkgroupsPerDimension: 32768,
      },
    }

    const hints = {
      deviceType: "discrete",
      maxSupportedLimits: DEFAULT_SUPPORTED_LIMITS,
      validationLevel: "strict",
    }

    // This should propagate hints to the nested WGPULimitsStruct validation
    WGPUDeviceDescriptorStruct.pack(deviceInput, { validationHints: hints })

    // Verify that the validation function was called with hints
    expect(capturedValidations).toHaveLength(1)
    const limitValidation = capturedValidations[0]

    expect(limitValidation.field).toBe("maxComputeWorkgroupsPerDimension")
    expect(limitValidation.value).toBe(32768)
    expect(limitValidation.hints).toEqual(hints)

    // Verify the hints contain the expected data
    expect(limitValidation.hints.deviceType).toBe("discrete")
    expect(limitValidation.hints.validationLevel).toBe("strict")
  })

  it("should propagate hints to nested structs with asPointer: false (inline structs)", () => {
    const capturedInlineValidations: any[] = []

    function validateInlineField(val: number, fieldName: string, { hints }: { hints?: any } = {}) {
      capturedInlineValidations.push({ field: fieldName, value: val, hints: { ...hints } })
    }

    const InlineStruct = defineStruct([["value", "u32", { validate: validateInlineField }]] as const)

    const ContainerStruct = defineStruct([
      ["label", "cstring"],
      ["inlineData", InlineStruct], // asPointer: false (default - inline)
    ] as const)

    capturedInlineValidations.length = 0

    const containerInput = {
      label: "test",
      inlineData: { value: 123 },
    }

    const inlineHints = {
      context: "inline-validation",
      level: "debug",
    }

    ContainerStruct.pack(containerInput, { validationHints: inlineHints })

    // Verify hints were propagated to inline struct
    expect(capturedInlineValidations).toHaveLength(1)
    const inlineValidation = capturedInlineValidations[0]

    expect(inlineValidation.field).toBe("value")
    expect(inlineValidation.value).toBe(123)
    expect(inlineValidation.hints).toEqual(inlineHints)
  })

  it("should handle validation failure in asPointer nested struct with hints", () => {
    function validateWithHints(val: number, fieldName: string, { hints }: { hints?: any } = {}) {
      const maxValue = hints?.maxAllowed || 1000
      if (val > maxValue) {
        throw new Error(`${fieldName} exceeds maximum allowed value ${maxValue} (got ${val})`)
      }
    }

    const LimitsStruct = defineStruct([["limit", "u32", { validate: validateWithHints }]] as const)

    const DeviceStruct = defineStruct([["limits", LimitsStruct, { asPointer: true }]] as const)

    const input = {
      limits: { limit: 2000 },
    }

    const hints = {
      maxAllowed: 1500,
    }

    // Should fail validation with hints applied
    expect(() => {
      DeviceStruct.pack(input, { validationHints: hints })
    }).toThrow("limit exceeds maximum allowed value 1500 (got 2000)")

    // Should work with higher limit
    const relaxedHints = {
      maxAllowed: 3000,
    }

    expect(() => {
      DeviceStruct.pack(input, { validationHints: relaxedHints })
    }).not.toThrow()
  })
})

describe("multiple validation functions", () => {
  it("should support single validation function (backward compatibility)", () => {
    const TestStruct = defineStruct([
      [
        "value",
        "u32",
        {
          validate: (value, fieldName) => {
            if (value < 10) {
              throw new Error(`${fieldName} must be >= 10`)
            }
          },
        },
      ],
    ] as const)

    // Valid input should work
    expect(() => {
      TestStruct.pack({ value: 15 })
    }).not.toThrow()

    // Invalid input should throw
    expect(() => {
      TestStruct.pack({ value: 5 })
    }).toThrow("value must be >= 10")
  })

  it("should support multiple validation functions", () => {
    const capturedValidations: string[] = []

    const TestStruct = defineStruct([
      [
        "value",
        "u32",
        {
          validate: [
            (value, fieldName) => {
              capturedValidations.push(`validate1:${fieldName}:${value}`)
              if (value < 10) {
                throw new Error(`${fieldName} must be >= 10 (validator 1)`)
              }
            },
            (value, fieldName) => {
              capturedValidations.push(`validate2:${fieldName}:${value}`)
              if (value > 100) {
                throw new Error(`${fieldName} must be <= 100 (validator 2)`)
              }
            },
            (value, fieldName) => {
              capturedValidations.push(`validate3:${fieldName}:${value}`)
              if (value % 2 !== 0) {
                throw new Error(`${fieldName} must be even (validator 3)`)
              }
            },
          ],
        },
      ],
    ] as const)

    capturedValidations.length = 0

    // Valid input should pass all validators
    expect(() => {
      TestStruct.pack({ value: 50 })
    }).not.toThrow()

    // All three validators should have been called
    expect(capturedValidations).toEqual(["validate1:value:50", "validate2:value:50", "validate3:value:50"])
  })

  it("should fail on first validation function and not call subsequent ones", () => {
    const capturedValidations: string[] = []

    const TestStruct = defineStruct([
      [
        "value",
        "u32",
        {
          validate: [
            (value, fieldName) => {
              capturedValidations.push(`validate1:${fieldName}:${value}`)
              if (value < 10) {
                throw new Error(`${fieldName} must be >= 10 (validator 1)`)
              }
            },
            (value, fieldName) => {
              capturedValidations.push(`validate2:${fieldName}:${value}`)
              if (value > 100) {
                throw new Error(`${fieldName} must be <= 100 (validator 2)`)
              }
            },
            (value, fieldName) => {
              capturedValidations.push(`validate3:${fieldName}:${value}`)
              throw new Error("This should not be called")
            },
          ],
        },
      ],
    ] as const)

    capturedValidations.length = 0

    // Should fail on first validator
    expect(() => {
      TestStruct.pack({ value: 5 })
    }).toThrow("value must be >= 10 (validator 1)")

    // Only first validator should have been called
    expect(capturedValidations).toEqual(["validate1:value:5"])
  })

  it("should fail on second validation function", () => {
    const capturedValidations: string[] = []

    const TestStruct = defineStruct([
      [
        "value",
        "u32",
        {
          validate: [
            (value, fieldName) => {
              capturedValidations.push(`validate1:${fieldName}:${value}`)
              if (value < 10) {
                throw new Error(`${fieldName} must be >= 10 (validator 1)`)
              }
            },
            (value, fieldName) => {
              capturedValidations.push(`validate2:${fieldName}:${value}`)
              if (value > 50) {
                throw new Error(`${fieldName} must be <= 50 (validator 2)`)
              }
            },
            (value, fieldName) => {
              capturedValidations.push(`validate3:${fieldName}:${value}`)
              throw new Error("This should not be called")
            },
          ],
        },
      ],
    ] as const)

    capturedValidations.length = 0

    // Should pass first validator but fail on second
    expect(() => {
      TestStruct.pack({ value: 75 })
    }).toThrow("value must be <= 50 (validator 2)")

    // First two validators should have been called
    expect(capturedValidations).toEqual(["validate1:value:75", "validate2:value:75"])
  })

  it("should pass validation hints to all validation functions", () => {
    const capturedHints: any[] = []

    const TestStruct = defineStruct([
      [
        "value",
        "u32",
        {
          validate: [
            (value, fieldName, { hints }) => {
              capturedHints.push({ validator: 1, field: fieldName, value, hints: { ...hints } })
              const min = hints?.minValue || 0
              if (value < min) {
                throw new Error(`${fieldName} must be >= ${min} (validator 1)`)
              }
            },
            (value, fieldName, { hints }) => {
              capturedHints.push({ validator: 2, field: fieldName, value, hints: { ...hints } })
              const max = hints?.maxValue || 1000
              if (value > max) {
                throw new Error(`${fieldName} must be <= ${max} (validator 2)`)
              }
            },
            (value, fieldName, { hints }) => {
              capturedHints.push({ validator: 3, field: fieldName, value, hints: { ...hints } })
              const multiplier = hints?.mustBeMultipleOf || 1
              if (value % multiplier !== 0) {
                throw new Error(`${fieldName} must be multiple of ${multiplier} (validator 3)`)
              }
            },
          ],
        },
      ],
    ] as const)

    capturedHints.length = 0

    const testHints = {
      minValue: 10,
      maxValue: 100,
      mustBeMultipleOf: 5,
      context: "test-validation",
    }

    // Valid input should pass all validators
    expect(() => {
      TestStruct.pack({ value: 50 }, { validationHints: testHints })
    }).not.toThrow()

    // All validators should have received the same hints
    expect(capturedHints).toHaveLength(3)

    for (let i = 0; i < 3; i++) {
      expect(capturedHints[i].validator).toBe(i + 1)
      expect(capturedHints[i].field).toBe("value")
      expect(capturedHints[i].value).toBe(50)
      expect(capturedHints[i].hints).toEqual(testHints)
    }

    // Test validation failure with hints
    capturedHints.length = 0

    expect(() => {
      TestStruct.pack({ value: 47 }, { validationHints: testHints })
    }).toThrow("value must be multiple of 5 (validator 3)")

    // Should have called all validators since 47 passes first two but fails third
    expect(capturedHints).toHaveLength(3)
  })

  it("should support mix of single and multiple validation functions in same struct", () => {
    const capturedValidations: string[] = []

    const TestStruct = defineStruct([
      [
        "singleValidated",
        "u32",
        {
          validate: (value, fieldName) => {
            capturedValidations.push(`single:${fieldName}:${value}`)
            if (value === 0) {
              throw new Error(`${fieldName} cannot be zero`)
            }
          },
        },
      ],
      [
        "multiValidated",
        "u32",
        {
          validate: [
            (value, fieldName) => {
              capturedValidations.push(`multi1:${fieldName}:${value}`)
              if (value < 10) {
                throw new Error(`${fieldName} must be >= 10`)
              }
            },
            (value, fieldName) => {
              capturedValidations.push(`multi2:${fieldName}:${value}`)
              if (value > 20) {
                throw new Error(`${fieldName} must be <= 20`)
              }
            },
          ],
        },
      ],
      ["noValidation", "u32"],
    ] as const)

    capturedValidations.length = 0

    // Valid input should work
    expect(() => {
      TestStruct.pack({
        singleValidated: 5,
        multiValidated: 15,
        noValidation: 999,
      })
    }).not.toThrow()

    // Should have called single validator once and multiple validators twice
    expect(capturedValidations).toEqual([
      "single:singleValidated:5",
      "multi1:multiValidated:15",
      "multi2:multiValidated:15",
    ])

    // Test failure in single validator
    capturedValidations.length = 0

    expect(() => {
      TestStruct.pack({
        singleValidated: 0,
        multiValidated: 15,
        noValidation: 999,
      })
    }).toThrow("singleValidated cannot be zero")

    expect(capturedValidations).toEqual(["single:singleValidated:0"])
  })

  it("should support multiple validation functions in nested structs", () => {
    const capturedValidations: string[] = []

    const NestedStruct = defineStruct([
      [
        "nestedValue",
        "u32",
        {
          validate: [
            (value, fieldName) => {
              capturedValidations.push(`nested1:${fieldName}:${value}`)
              if (value < 5) {
                throw new Error(`${fieldName} must be >= 5 (nested validator 1)`)
              }
            },
            (value, fieldName) => {
              capturedValidations.push(`nested2:${fieldName}:${value}`)
              if (value % 5 !== 0) {
                throw new Error(`${fieldName} must be multiple of 5 (nested validator 2)`)
              }
            },
          ],
        },
      ],
    ] as const)

    const ParentStruct = defineStruct([
      [
        "parentValue",
        "u32",
        {
          validate: [
            (value, fieldName) => {
              capturedValidations.push(`parent1:${fieldName}:${value}`)
              if (value === 0) {
                throw new Error(`${fieldName} cannot be zero (parent validator 1)`)
              }
            },
            (value, fieldName) => {
              capturedValidations.push(`parent2:${fieldName}:${value}`)
              if (value > 100) {
                throw new Error(`${fieldName} must be <= 100 (parent validator 2)`)
              }
            },
          ],
        },
      ],
      ["nested", NestedStruct],
    ] as const)

    capturedValidations.length = 0

    // Valid input should work
    expect(() => {
      ParentStruct.pack({
        parentValue: 50,
        nested: { nestedValue: 10 },
      })
    }).not.toThrow()

    // Should have called all validators in order
    expect(capturedValidations).toEqual([
      "parent1:parentValue:50",
      "parent2:parentValue:50",
      "nested1:nestedValue:10",
      "nested2:nestedValue:10",
    ])

    // Test failure in nested validation
    capturedValidations.length = 0

    expect(() => {
      ParentStruct.pack({
        parentValue: 50,
        nested: { nestedValue: 7 }, // Not multiple of 5
      })
    }).toThrow("nestedValue must be multiple of 5 (nested validator 2)")

    expect(capturedValidations).toEqual([
      "parent1:parentValue:50",
      "parent2:parentValue:50",
      "nested1:nestedValue:7",
      "nested2:nestedValue:7",
    ])
  })

  it("should support multiple validation functions with real-world GPU limits scenario", () => {
    const capturedValidations: any[] = []

    function validateMultipleOf(val: number, fieldName: string, hints?: any) {
      capturedValidations.push({ validator: "multipleOf", field: fieldName, value: val })
      if (val % 2 !== 0) {
        throw new Error(`${fieldName} must be multiple of 2`)
      }
    }

    function validateRange(val: number, min: number, max: number) {
      if (val < min || val > max) {
        throw new Error(`Value must be between ${min} and ${max}, got ${val}`)
      }
    }

    function validateLimitField(val: number, fieldName: string, { hints }: { hints?: any } = {}) {
      capturedValidations.push({ validator: "limitField", field: fieldName, value: val, hints })
      if (hints && fieldName in hints) {
        const maxValue = hints[fieldName as keyof typeof hints] as number
        validateRange(val, 0, maxValue)
      } else {
        validateRange(val, 0, Number.MAX_SAFE_INTEGER)
      }
    }

    const LimitsStruct = defineStruct([
      [
        "maxTextureDimension2D",
        "u32",
        {
          default: 8192,
          validate: validateLimitField,
        },
      ],
      [
        "minUniformBufferOffsetAlignment",
        "u32",
        {
          default: 256,
          validate: [validateMultipleOf, validateLimitField], // Multiple validators
        },
      ],
      [
        "maxVertexBuffers",
        "u32",
        {
          default: 8,
          validate: validateLimitField,
        },
      ],
    ] as const)

    capturedValidations.length = 0

    const limits = {
      maxTextureDimension2D: 4096,
      minUniformBufferOffsetAlignment: 128,
      maxVertexBuffers: 4,
    }

    const hints = {
      maxTextureDimension2D: 8192,
      minUniformBufferOffsetAlignment: 512,
      maxVertexBuffers: 16,
    }

    // Should pass all validations
    expect(() => {
      LimitsStruct.pack(limits, { validationHints: hints })
    }).not.toThrow()

    // Verify all validators were called
    expect(capturedValidations).toEqual([
      { validator: "limitField", field: "maxTextureDimension2D", value: 4096, hints },
      { validator: "multipleOf", field: "minUniformBufferOffsetAlignment", value: 128 },
      { validator: "limitField", field: "minUniformBufferOffsetAlignment", value: 128, hints },
      { validator: "limitField", field: "maxVertexBuffers", value: 4, hints },
    ])

    // Test failure on multiple validators - should fail on first (multipleOf)
    capturedValidations.length = 0

    expect(() => {
      LimitsStruct.pack(
        {
          ...limits,
          minUniformBufferOffsetAlignment: 127, // Odd number, fails multipleOf
        },
        { validationHints: hints },
      )
    }).toThrow("minUniformBufferOffsetAlignment must be multiple of 2")

    // Should have called single validator for first field, then failed on first validator of second field
    expect(capturedValidations).toEqual([
      { validator: "limitField", field: "maxTextureDimension2D", value: 4096, hints },
      { validator: "multipleOf", field: "minUniformBufferOffsetAlignment", value: 127 },
    ])
  })

  it("should support empty validation array (edge case)", () => {
    const TestStruct = defineStruct([
      ["value", "u32", { validate: [] }], // Empty array
      ["otherValue", "u32"], // No validation
    ] as const)

    // Should work fine with empty validation array
    expect(() => {
      TestStruct.pack({ value: 123, otherValue: 456 })
    }).not.toThrow()

    const packed = TestStruct.pack({ value: 123, otherValue: 456 })
    const unpacked = TestStruct.unpack(packed)

    expect(unpacked.value).toBe(123)
    expect(unpacked.otherValue).toBe(456)
  })
})
