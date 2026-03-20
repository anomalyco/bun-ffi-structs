import { expect, describe, it } from "bun:test"
import { defineEnum, defineStruct, objectPtr, allocStruct } from "../structs_ffi.js"

describe("struct utilities", () => {
  it("should allocate struct buffer", () => {
    const TestStruct = defineStruct([
      ["a", "u32"],
      ["b", "f32"],
    ] as const)

    const { buffer, view } = allocStruct(TestStruct)
    expect(buffer.byteLength).toBe(TestStruct.size)
    expect(view.buffer).toBe(buffer)
  })

  it("should describe struct layout", () => {
    const TestStruct = defineStruct([
      ["a", "u8"],
      ["b", "u32"],
      ["c", "f32", { optional: true }],
    ] as const)

    const description = TestStruct.describe()
    expect(description).toHaveLength(3)

    const fieldA = description.find((f) => f.name === "a")
    expect(fieldA?.size).toBe(1)
    expect(fieldA?.optional).toBe(false)

    const fieldC = description.find((f) => f.name === "c")
    expect(fieldC?.optional).toBe(true)
  })

  describe("allocStruct with pre-allocated arrays", () => {
    it("should allocate sub-buffers for primitive arrays", () => {
      const TestStruct = defineStruct([
        ["itemCount", "u32", { lengthOf: "items" }],
        ["items", ["u32"]],
        ["otherField", "f32"],
      ] as const)

      const { buffer, view, subBuffers } = allocStruct(TestStruct, {
        lengths: { items: 5 },
      })

      expect(buffer.byteLength).toBe(TestStruct.size)
      expect(view.buffer).toBe(buffer)
      expect(subBuffers).toBeDefined()

      // Verify length field was set
      const layout = TestStruct.describe()
      const itemCountField = layout.find((f) => f.name === "itemCount")!
      const itemCount = view.getUint32(itemCountField.offset, true)
      expect(itemCount).toBe(5)

      // Verify items pointer was set
      const itemsField = layout.find((f) => f.name === "items")!
      const itemsPtr = view.getBigUint64(itemsField.offset, true)
      expect(itemsPtr).not.toBe(0n)
    })

    it("should allocate correct sizes for different primitive types", () => {
      const TestStruct = defineStruct([
        ["u8Count", "u32", { lengthOf: "u8Array" }],
        ["u8Array", ["u8"]],
        ["u32Count", "u32", { lengthOf: "u32Array" }],
        ["u32Array", ["u32"]],
        ["f64Count", "u32", { lengthOf: "f64Array" }],
        ["f64Array", ["f64"]],
        ["u64Count", "u32", { lengthOf: "u64Array" }],
        ["u64Array", ["u64"]],
      ] as const)

      const result = allocStruct(TestStruct, {
        lengths: {
          u8Array: 10,
          u32Array: 5,
          f64Array: 3,
          u64Array: 2,
        },
      })

      expect(result.subBuffers).toBeDefined()
      const subBuffers = result.subBuffers!

      // Verify correct buffer sizes based on element type
      expect(subBuffers["u8Array"]?.byteLength).toBe(10 * 1) // 10 u8 = 10 bytes
      expect(subBuffers["u32Array"]?.byteLength).toBe(5 * 4) // 5 u32 = 20 bytes
      expect(subBuffers["f64Array"]?.byteLength).toBe(3 * 8) // 3 f64 = 24 bytes
      expect(subBuffers["u64Array"]?.byteLength).toBe(2 * 8) // 2 u64 = 16 bytes
    })

    it("should allocate correct sizes for enum arrays", () => {
      const U8Enum = defineEnum({ A: 0, B: 1 }, "u8")
      const U32Enum = defineEnum({ X: 0, Y: 1 }, "u32")

      const TestStruct = defineStruct([
        ["u8EnumCount", "u32", { lengthOf: "u8Enums" }],
        ["u8Enums", [U8Enum]],
        ["u32EnumCount", "u32", { lengthOf: "u32Enums" }],
        ["u32Enums", [U32Enum]],
      ] as const)

      const result = allocStruct(TestStruct, {
        lengths: { u8Enums: 6, u32Enums: 4 },
      })

      expect(result.subBuffers).toBeDefined()
      const subBuffers = result.subBuffers!

      // Enum arrays should use the base type size
      expect(subBuffers["u8Enums"]?.byteLength).toBe(6 * 1) // 6 u8 enums = 6 bytes
      expect(subBuffers["u32Enums"]?.byteLength).toBe(4 * 4) // 4 u32 enums = 16 bytes
    })

    it("should allocate correct sizes for struct arrays", () => {
      const SmallStruct = defineStruct([
        ["x", "u32"],
        ["y", "u32"],
      ] as const) // 8 bytes

      const LargeStruct = defineStruct([
        ["a", "u64"],
        ["b", "f64"],
        ["c", "u32"],
      ] as const) // 20 bytes (with padding)

      const TestStruct = defineStruct([
        ["smallCount", "u32", { lengthOf: "smallStructs" }],
        ["smallStructs", [SmallStruct]],
        ["largeCount", "u32", { lengthOf: "largeStructs" }],
        ["largeStructs", [LargeStruct]],
      ] as const)

      const result = allocStruct(TestStruct, {
        lengths: { smallStructs: 3, largeStructs: 2 },
      })

      expect(result.subBuffers).toBeDefined()
      const subBuffers = result.subBuffers!

      // Struct arrays should use actual struct sizes
      expect(subBuffers["smallStructs"]?.byteLength).toBe(3 * SmallStruct.size)
      expect(subBuffers["largeStructs"]?.byteLength).toBe(2 * LargeStruct.size)
    })

    it("should allocate correct sizes for object pointer arrays", () => {
      interface TestObject {
        ptr: number | bigint | null
      }

      const TestStruct = defineStruct([
        ["objectCount", "u32", { lengthOf: "objects" }],
        ["objects", [objectPtr<TestObject>()]],
      ] as const)

      const result = allocStruct(TestStruct, {
        lengths: { objects: 5 },
      })

      expect(result.subBuffers).toBeDefined()
      const subBuffers = result.subBuffers!

      // Object pointer arrays should use pointer size
      const pointerSize = process.arch === "x64" || process.arch === "arm64" ? 8 : 4
      expect(subBuffers["objects"]?.byteLength).toBe(5 * pointerSize)
    })

    it("should handle zero-length arrays", () => {
      const TestStruct = defineStruct([
        ["itemCount", "u32", { lengthOf: "items" }],
        ["items", ["u32"]],
      ] as const)

      const result = allocStruct(TestStruct, {
        lengths: { items: 0 },
      })

      expect(result.subBuffers).toBeDefined()
      const subBuffers = result.subBuffers!

      // Zero-length array should create zero-size buffer
      expect(subBuffers["items"]?.byteLength).toBe(0)

      // But length field should still be set correctly
      const layout = TestStruct.describe()
      const itemCountField = layout.find((f) => f.name === "itemCount")!
      const itemCount = result.view.getUint32(itemCountField.offset, true)
      expect(itemCount).toBe(0)
    })

    it("should work without lengths specified", () => {
      const TestStruct = defineStruct([
        ["itemCount", "u32", { lengthOf: "items" }],
        ["items", ["u32"]],
      ] as const)

      const { buffer, view, subBuffers } = allocStruct(TestStruct)

      expect(buffer.byteLength).toBe(TestStruct.size)
      expect(view.buffer).toBe(buffer)
      expect(subBuffers).toBeUndefined()
    })

    it("should verify type information in describe output", () => {
      const TestEnum = defineEnum({ A: 0, B: 1 })
      const InnerStruct = defineStruct([["x", "u32"]] as const)

      const TestStruct = defineStruct([
        ["primitiveField", "u32"],
        ["enumField", TestEnum],
        ["structField", InnerStruct],
        ["arrayField", ["u32"]],
        ["lengthField", "u32", { lengthOf: "arrayField" }],
      ] as const)

      const description = TestStruct.describe()

      const primitiveField = description.find((f) => f.name === "primitiveField")!
      expect(primitiveField.type).toBe("u32")
      expect(primitiveField.lengthOf).toBeUndefined()

      const lengthField = description.find((f) => f.name === "lengthField")!
      expect(lengthField.lengthOf).toBe("arrayField")

      const arrayField = description.find((f) => f.name === "arrayField")!
      expect(Array.isArray(arrayField.type)).toBe(true)
    })
  })
})
