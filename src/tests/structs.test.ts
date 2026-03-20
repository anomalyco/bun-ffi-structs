import { expect, describe, it } from "bun:test"
import { defineEnum, defineStruct, objectPtr, allocStruct, packObjectArray } from "../structs_ffi.js"
import { toArrayBuffer } from "bun:ffi"

describe("Structs FFI", () => {
  describe("defineEnum", () => {
    it("should create enum with correct mapping", () => {
      const TestEnum = defineEnum({
        VALUE_A: 0,
        VALUE_B: 1,
        VALUE_C: 42,
      })

      expect(TestEnum.to("VALUE_A")).toBe(0)
      expect(TestEnum.to("VALUE_B")).toBe(1)
      expect(TestEnum.to("VALUE_C")).toBe(42)

      expect(TestEnum.from(0)).toBe("VALUE_A")
      expect(TestEnum.from(1)).toBe("VALUE_B")
      expect(TestEnum.from(42)).toBe("VALUE_C")
    })

    it("should support different base types", () => {
      const U8Enum = defineEnum({ A: 0, B: 255 }, "u8")
      const U64Enum = defineEnum({ X: 0, Y: 1 }, "u64")

      expect(U8Enum.type).toBe("u8")
      expect(U64Enum.type).toBe("u64")
    })

    it("should throw on invalid enum values", () => {
      const TestEnum = defineEnum({ VALID: 0 })

      expect(() => TestEnum.to("INVALID" as any)).toThrow()
      expect(() => TestEnum.from(999)).toThrow()
    })
  })

  describe("primitive types", () => {
    it("should pack and unpack u8 correctly", () => {
      const TestStruct = defineStruct([["value", "u8"]] as const)

      const packed = TestStruct.pack({ value: 123 })
      expect(packed.byteLength).toBe(1)

      const unpacked = TestStruct.unpack(packed)
      expect(unpacked.value).toBe(123)
    })

    it("should pack and unpack u32 correctly", () => {
      const TestStruct = defineStruct([["value", "u32"]] as const)

      const packed = TestStruct.pack({ value: 0x12345678 })
      expect(packed.byteLength).toBe(4)

      const unpacked = TestStruct.unpack(packed)
      expect(unpacked.value).toBe(0x12345678)
    })

    it("should pack and unpack f32 correctly", () => {
      const TestStruct = defineStruct([["value", "f32"]] as const)

      const testValue = 3.14159
      const packed = TestStruct.pack({ value: testValue })
      expect(packed.byteLength).toBe(4)

      const unpacked = TestStruct.unpack(packed)
      expect(unpacked.value).toBeCloseTo(testValue, 5)
    })

    it("should pack and unpack bool types correctly", () => {
      const TestStruct = defineStruct([
        ["flag8", "bool_u8"],
        ["flag32", "bool_u32"],
      ] as const)

      const packed = TestStruct.pack({ flag8: true, flag32: false })
      expect(packed.byteLength).toBe(8) // 1 + 3 padding + 4 = 8 bytes due to alignment

      const unpacked = TestStruct.unpack(packed)
      expect(unpacked.flag8).toBe(true)
      expect(unpacked.flag32).toBe(false)
    })
  })

  describe("struct definition", () => {
    it("should create struct with correct size and alignment", () => {
      const TestStruct = defineStruct([
        ["a", "u8"],
        ["b", "u32"],
        ["c", "u8"],
      ] as const)

      // u8(1) + padding(3) + u32(4) + u8(1) + padding(3) = 12 bytes
      expect(TestStruct.size).toBe(12)
      expect(TestStruct.align).toBe(4)
    })

    it("should pack and unpack simple struct", () => {
      const TestStruct = defineStruct([
        ["x", "f32"],
        ["y", "f32"],
        ["count", "u32"],
      ] as const)

      const input = { x: 1.5, y: 2.5, count: 10 }
      const packed = TestStruct.pack(input)
      const unpacked = TestStruct.unpack(packed)

      expect(unpacked.x).toBeCloseTo(1.5)
      expect(unpacked.y).toBeCloseTo(2.5)
      expect(unpacked.count).toBe(10)
    })

    it("should handle optional fields with defaults", () => {
      const TestStruct = defineStruct([
        ["required", "u32"],
        ["optional", "u32", { optional: true, default: 42 }],
      ] as const)

      const packed = TestStruct.pack({ required: 100 })
      const unpacked = TestStruct.unpack(packed)

      expect(unpacked.required).toBe(100)
      expect(unpacked.optional).toBe(42)
    })

    it("should support enum fields", () => {
      const TestEnum = defineEnum({
        OPTION_A: 0,
        OPTION_B: 1,
        OPTION_C: 2,
      })

      const TestStruct = defineStruct([
        ["option", TestEnum],
        ["value", "u32"],
      ] as const)

      const input = { option: "OPTION_B" as const, value: 123 }
      const packed = TestStruct.pack(input)
      const unpacked = TestStruct.unpack(packed)

      expect(unpacked.option).toBe("OPTION_B")
      expect(unpacked.value).toBe(123)
    })
  })

  describe("nested structs", () => {
    it("should handle inline nested structs", () => {
      const InnerStruct = defineStruct([
        ["x", "f32"],
        ["y", "f32"],
      ] as const)

      const OuterStruct = defineStruct([
        ["position", InnerStruct],
        ["scale", "f32"],
      ] as const)

      const input = {
        position: { x: 1.0, y: 2.0 },
        scale: 3.0,
      }

      const packed = OuterStruct.pack(input)
      const unpacked = OuterStruct.unpack(packed)

      expect(unpacked.position.x).toBeCloseTo(1.0)
      expect(unpacked.position.y).toBeCloseTo(2.0)
      expect(unpacked.scale).toBeCloseTo(3.0)
    })

    it("should unpack complex nested structs with multiple levels and different types", () => {
      const ColorEnum = defineEnum({
        RED: 0,
        GREEN: 1,
        BLUE: 2,
      })

      // Level 3 nested struct
      const PositionStruct = defineStruct([
        ["x", "f32"],
        ["y", "f32"],
        ["z", "f32"],
      ] as const)

      // Level 2 nested struct with enum and primitives
      const MaterialStruct = defineStruct([
        ["color", ColorEnum],
        ["opacity", "f32", { default: 1.0 }],
        ["roughness", "f32"],
        ["metallic", "bool_u32", { default: false }],
      ] as const)

      // Level 1 nested struct combining the above
      const ObjectStruct = defineStruct([
        ["id", "u32"],
        ["position", PositionStruct],
        ["material", MaterialStruct],
        ["scale", "f32", { default: 1.0 }],
      ] as const)

      // Top level struct
      const SceneStruct = defineStruct([
        ["name", "cstring"],
        ["objectCount", "u32"],
        ["mainObject", ObjectStruct],
        ["ambientLight", "f32"],
        ["enableShadows", "bool_u8"],
      ] as const)

      const input = {
        name: "test-scene",
        objectCount: 1,
        mainObject: {
          id: 42,
          position: { x: 10.5, y: -5.2, z: 3.7 },
          material: {
            color: "BLUE" as const,
            roughness: 0.8,
            // opacity and metallic will use defaults
          },
          // scale will use default
        },
        ambientLight: 0.3,
        enableShadows: true,
      }

      const packed = SceneStruct.pack(input)
      const unpacked = SceneStruct.unpack(packed)

      // Verify top level fields
      expect(unpacked.objectCount).toBe(1)
      expect(unpacked.ambientLight).toBeCloseTo(0.3)
      expect(unpacked.enableShadows).toBe(true)

      // Verify level 1 nested struct
      expect(unpacked.mainObject.id).toBe(42)
      expect(unpacked.mainObject.scale).toBeCloseTo(1.0) // default value

      // Verify level 2 nested struct (position)
      expect(unpacked.mainObject.position.x).toBeCloseTo(10.5)
      expect(unpacked.mainObject.position.y).toBeCloseTo(-5.2)
      expect(unpacked.mainObject.position.z).toBeCloseTo(3.7)

      // Verify level 2 nested struct (material) with enum and defaults
      expect(unpacked.mainObject.material.color).toBe("BLUE")
      expect(unpacked.mainObject.material.roughness).toBeCloseTo(0.8)
      expect(unpacked.mainObject.material.opacity).toBeCloseTo(1.0) // default value
      expect(unpacked.mainObject.material.metallic).toBe(false) // default value
    })

    it("should unpack optional nested structs correctly", () => {
      const ConfigStruct = defineStruct([
        ["enabled", "bool_u32", { default: false }],
        ["timeout", "u32", { default: 5000 }],
      ] as const)

      const ServiceStruct = defineStruct([
        ["name", "cstring"],
        ["port", "u32"],
        ["config", ConfigStruct, { optional: true }],
        ["fallbackPort", "u32", { default: 8080 }],
      ] as const)

      // Test with config provided
      const inputWithConfig = {
        name: "test-service",
        port: 3000,
        config: {
          enabled: true,
          timeout: 10000,
        },
      }

      const packedWithConfig = ServiceStruct.pack(inputWithConfig)
      const unpackedWithConfig = ServiceStruct.unpack(packedWithConfig)

      expect(unpackedWithConfig.port).toBe(3000)
      expect(unpackedWithConfig.fallbackPort).toBe(8080) // default
      expect(unpackedWithConfig.config).toBeDefined()
      expect(unpackedWithConfig.config!.enabled).toBe(true)
      expect(unpackedWithConfig.config!.timeout).toBe(10000)

      // Test with empty config (should get defaults)
      const inputWithEmptyConfig = {
        name: "test-service-2",
        port: 4000,
        config: {}, // Empty config should get defaults
      }

      const packedWithEmptyConfig = ServiceStruct.pack(inputWithEmptyConfig)
      const unpackedWithEmptyConfig = ServiceStruct.unpack(packedWithEmptyConfig)

      expect(unpackedWithEmptyConfig.port).toBe(4000)
      expect(unpackedWithEmptyConfig.config).toBeDefined()
      expect(unpackedWithEmptyConfig.config!.enabled).toBe(false) // default value
      expect(unpackedWithEmptyConfig.config!.timeout).toBe(5000) // explicit default
    })

    it("should handle nested structs with different alignments correctly", () => {
      // Create structs with different alignment requirements
      const SmallStruct = defineStruct([
        ["a", "u8"],
        ["b", "u8"],
      ] as const)

      const LargeStruct = defineStruct([
        ["x", "u64"],
        ["y", "f64"],
      ] as const)

      const MixedStruct = defineStruct([
        ["flag", "u8"],
        ["small", SmallStruct], // Should be aligned properly
        ["big", LargeStruct], // Should force 8-byte alignment
        ["value", "u32"],
      ] as const)

      const input = {
        flag: 255,
        small: { a: 10, b: 20 },
        big: { x: 0x1234567890abcdefn, y: 3.14159 },
        value: 0xdeadbeef,
      }

      const packed = MixedStruct.pack(input)
      const unpacked = MixedStruct.unpack(packed)

      // Verify all fields unpacked correctly despite alignment complexity
      expect(unpacked.flag).toBe(255)
      expect(unpacked.small.a).toBe(10)
      expect(unpacked.small.b).toBe(20)
      expect(unpacked.big.x).toBe(0x1234567890abcdefn)
      expect(unpacked.big.y).toBeCloseTo(3.14159)
      expect(unpacked.value).toBe(0xdeadbeef)

      // Verify struct has expected size (considering alignment)
      expect(MixedStruct.size).toBeGreaterThan(1 + 2 + 16 + 4) // At least the sum of field sizes
    })
  })

  describe("arrays", () => {
    it("should pack and unpack primitive arrays", () => {
      const TestStruct = defineStruct([
        ["count", "u32", { lengthOf: "values" }],
        ["values", ["u32"]],
      ] as const)

      const input = { values: [1, 2, 3, 4, 5] }
      const packed = TestStruct.pack(input)
      const unpacked = TestStruct.unpack(packed)

      expect(unpacked.count).toBe(5)
      expect(unpacked.values).toEqual([1, 2, 3, 4, 5])
    })

    it("should pack and unpack different primitive array types", () => {
      const TestStruct = defineStruct([
        ["u8Count", "u32", { lengthOf: "u8Array" }],
        ["u8Array", ["u8"]],
        ["f32Count", "u32", { lengthOf: "f32Array" }],
        ["f32Array", ["f32"]],
        ["i32Count", "u32", { lengthOf: "i32Array" }],
        ["i32Array", ["i32"]],
      ] as const)

      const input = {
        u8Array: [1, 2, 3],
        f32Array: [1.5, 2.5, 3.5],
        i32Array: [-10, 0, 10],
      }
      const packed = TestStruct.pack(input)
      const unpacked = TestStruct.unpack(packed)

      expect(unpacked.u8Count).toBe(3)
      expect(unpacked.u8Array).toEqual([1, 2, 3])
      expect(unpacked.f32Count).toBe(3)
      const f32Array = unpacked.f32Array as number[]
      expect(f32Array[0]).toBeCloseTo(1.5)
      expect(f32Array[1]).toBeCloseTo(2.5)
      expect(f32Array[2]).toBeCloseTo(3.5)
      expect(unpacked.i32Count).toBe(3)
      expect(unpacked.i32Array).toEqual([-10, 0, 10])
    })

    it("should unpack empty primitive arrays", () => {
      const TestStruct = defineStruct([
        ["count", "u32", { lengthOf: "values" }],
        ["values", ["u32"]],
      ] as const)

      const input = { values: [] }
      const packed = TestStruct.pack(input)
      const unpacked = TestStruct.unpack(packed)

      expect(unpacked.count).toBe(0)
      expect(unpacked.values).toEqual([])
    })

    it("should pack enum arrays with length field", () => {
      const TestEnum = defineEnum({
        RED: 0,
        GREEN: 1,
        BLUE: 2,
      })

      const TestStruct = defineStruct([
        ["colorCount", "u32", { lengthOf: "colors" }],
        ["colors", [TestEnum]],
      ] as const)

      const input = { colors: ["RED", "GREEN", "BLUE"] as const }
      const packed = TestStruct.pack(input)
      const unpacked = TestStruct.unpack(packed)

      expect(unpacked.colorCount).toBe(3)
      expect(unpacked.colors).toEqual(["RED", "GREEN", "BLUE"])
    })
  })

  describe("object pointers", () => {
    interface TestObject {
      ptr: number | bigint | null
      name?: string
    }

    it("should pack object pointers", () => {
      const TestStruct = defineStruct([["objectRef", objectPtr<TestObject>()]] as const)

      const mockObject: TestObject = { ptr: 0x12345678 }
      const input = { objectRef: mockObject }

      const packed = TestStruct.pack(input)
      expect(packed.byteLength).toBeGreaterThan(0)
    })

    it("should pack null object pointers", () => {
      const TestStruct = defineStruct([["objectRef", objectPtr<TestObject>(), { optional: true }]] as const)

      const input = { objectRef: null }
      const packed = TestStruct.pack(input)

      expect(packed.byteLength).toBeGreaterThan(0)
    })

    it("should pack object pointer arrays", () => {
      const objects: (TestObject | null)[] = [{ ptr: 0x1000 }, { ptr: 0x2000 }, null, { ptr: 0x3000 }]

      const packed = packObjectArray(objects)
      expect(packed.byteLength).toBe(objects.length * (process.arch === "x64" || process.arch === "arm64" ? 8 : 4))
    })
  })

  describe("error handling", () => {
    it("should throw on missing required field", () => {
      const TestStruct = defineStruct([["required", "u32"]] as const)

      expect(() => {
        TestStruct.pack({} as any)
      }).toThrow()
    })

    it("should throw on buffer too small for unpacking", () => {
      const TestStruct = defineStruct([
        ["a", "u32"],
        ["b", "u32"],
      ] as const)

      const smallBuffer = new ArrayBuffer(4) // Only room for one u32

      expect(() => {
        TestStruct.unpack(smallBuffer)
      }).toThrow()
    })
  })

  describe("empty object defaults", () => {
    it("should apply defaults when packing empty objects", () => {
      const SamplerStruct = defineStruct([
        ["type", "u32", { default: 2 }], // filtering = 2
      ] as const)

      // Test packing with empty object vs undefined
      const emptyObjectPacked = SamplerStruct.pack({})

      const emptyView = new DataView(emptyObjectPacked)

      // Empty object should apply the default value of 2
      expect(emptyView.getUint32(0, true)).toBe(2)
    })

    it("should handle nested struct with empty object", () => {
      const SamplerStruct = defineStruct([["type", "u32", { default: 2 }]] as const)

      const EntryStruct = defineStruct([
        ["binding", "u32"],
        ["sampler", SamplerStruct, { optional: true }],
      ] as const)

      // This mimics the GPUDevice scenario: sampler: {}
      const packed = EntryStruct.pack({
        binding: 1,
        sampler: {}, // Empty object - should get defaults
      })

      const view = new DataView(packed)
      const binding = view.getUint32(0, true)
      const samplerType = view.getUint32(4, true) // sampler.type after binding field

      expect(binding).toBe(1)
      expect(samplerType).toBe(2) // Should have default applied
    })
  })
})
