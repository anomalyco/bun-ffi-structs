import { expect, describe, it } from "bun:test"
import { defineStruct } from "../structs_ffi"
import { ptr } from "bun:ffi"

describe("char* automatic unpacking", () => {
  it("should automatically unpack char* to string when lengthOf field exists", () => {
    const StringStruct = defineStruct([
      ["data", "char*"],
      ["length", "u64", { lengthOf: "data" }],
    ] as const)

    const testString = "Hello, World!"
    const packed = StringStruct.pack({ data: testString })
    const unpacked = StringStruct.unpack(packed)

    expect(typeof unpacked.data).toBe("string")
    expect(unpacked.data).toBe(testString)
    expect(unpacked.length).toBe(BigInt(Buffer.byteLength(testString)))
  })

  it("should handle emoji strings correctly", () => {
    const StringStruct = defineStruct([
      ["data", "char*"],
      ["length", "u32", { lengthOf: "data" }],
    ] as const)

    const testString = "Hello 🌍🎉✨"
    const packed = StringStruct.pack({ data: testString })
    const unpacked = StringStruct.unpack(packed)

    expect(unpacked.data).toBe(testString)
  })

  it("should handle complex unicode grapheme clusters", () => {
    const StringStruct = defineStruct([
      ["data", "char*"],
      ["length", "u64", { lengthOf: "data" }],
    ] as const)

    const testString = "👨‍👩‍👧‍👦🏳️‍🌈🇺🇸"
    const packed = StringStruct.pack({ data: testString })
    const unpacked = StringStruct.unpack(packed)

    expect(unpacked.data).toBe(testString)
  })

  it("should handle null char* pointers", () => {
    const StringStruct = defineStruct([
      ["data", "char*", { optional: true }],
      ["length", "u64", { lengthOf: "data" }],
    ] as const)

    const packed = StringStruct.pack({ data: null })
    const unpacked = StringStruct.unpack(packed)

    expect(unpacked.data).toBeNull()
    expect(unpacked.length).toBe(0n)
  })

  it("should handle empty strings", () => {
    const StringStruct = defineStruct([
      ["data", "char*"],
      ["length", "u64", { lengthOf: "data" }],
    ] as const)

    const packed = StringStruct.pack({ data: "" })
    const unpacked = StringStruct.unpack(packed)

    expect(unpacked.data).toBeNull()
    expect(unpacked.length).toBe(0n)
  })

  it("should handle multiple char* fields in one struct", () => {
    const MultiStringStruct = defineStruct([
      ["field1", "char*"],
      ["length1", "u32", { lengthOf: "field1" }],
      ["field2", "char*"],
      ["length2", "u32", { lengthOf: "field2" }],
      ["field3", "char*"],
      ["length3", "u32", { lengthOf: "field3" }],
    ] as const)

    const packed = MultiStringStruct.pack({
      field1: "ASCII text",
      field2: "Emoji 🎉",
      field3: "Combined é",
    })
    const unpacked = MultiStringStruct.unpack(packed)

    expect(unpacked.field1).toBe("ASCII text")
    expect(unpacked.field2).toBe("Emoji 🎉")
    expect(unpacked.field3).toBe("Combined é")
  })

  it("should handle char* in nested structs", () => {
    const InnerStruct = defineStruct([
      ["content", "char*"],
      ["contentLength", "u64", { lengthOf: "content" }],
    ] as const)

    const OuterStruct = defineStruct([
      ["id", "u32"],
      ["message", InnerStruct],
      ["timestamp", "u64"],
    ] as const)

    const packed = OuterStruct.pack({
      id: 42,
      message: {
        content: "Hello! 👋 How are you? 😊",
      },
      timestamp: 1234567890n,
    })
    const unpacked = OuterStruct.unpack(packed)

    expect(unpacked.message.content).toBe("Hello! 👋 How are you? 😊")
    expect(unpacked.id).toBe(42)
    expect(unpacked.timestamp).toBe(1234567890n)
  })

  it("should handle char* with various length field types", () => {
    const testString = "Test string 🎉"

    // Test with u32
    const Struct32 = defineStruct([
      ["data", "char*"],
      ["length", "u32", { lengthOf: "data" }],
    ] as const)

    const packed32 = Struct32.pack({ data: testString })
    const unpacked32 = Struct32.unpack(packed32)
    expect(unpacked32.data).toBe(testString)

    // Test with u64
    const Struct64 = defineStruct([
      ["data", "char*"],
      ["length", "u64", { lengthOf: "data" }],
    ] as const)

    const packed64 = Struct64.pack({ data: testString })
    const unpacked64 = Struct64.unpack(packed64)
    expect(unpacked64.data).toBe(testString)

    // Test with u16
    const Struct16 = defineStruct([
      ["data", "char*"],
      ["length", "u16", { lengthOf: "data" }],
    ] as const)

    const packed16 = Struct16.pack({ data: testString })
    const unpacked16 = Struct16.unpack(packed16)
    expect(unpacked16.data).toBe(testString)
  })

  it("should return pointer for char* without lengthOf field", () => {
    const PointerStruct = defineStruct([
      ["data", "char*"],
      ["someOtherField", "u32"],
    ] as const)

    const packed = PointerStruct.pack({
      data: "test",
      someOtherField: 42,
    })
    const unpacked = PointerStruct.unpack(packed)

    // Without lengthOf, should return the pointer value (number)
    expect(typeof unpacked.data).toBe("number")
    expect(unpacked.data).toBeGreaterThan(0)
    expect(unpacked.someOtherField).toBe(42)
  })

  it("should handle very long strings", () => {
    const StringStruct = defineStruct([
      ["data", "char*"],
      ["length", "u32", { lengthOf: "data" }],
    ] as const)

    const testString = "a".repeat(10000) + "🎉".repeat(1000)
    const packed = StringStruct.pack({ data: testString })
    const unpacked = StringStruct.unpack(packed)

    expect(unpacked.data).toBe(testString)
    expect(unpacked.length).toBe(Buffer.byteLength(testString))
  })

  it("should handle strings with mixed ascii and unicode", () => {
    const StringStruct = defineStruct([
      ["data", "char*"],
      ["length", "u64", { lengthOf: "data" }],
    ] as const)

    const testString = "Hello Café 日本語 🌍 Привет"
    const packed = StringStruct.pack({ data: testString })
    const unpacked = StringStruct.unpack(packed)

    expect(unpacked.data).toBe(testString)
  })

  it("should handle char* with non-zero pointer but zero length", () => {
    const StringStruct = defineStruct([
      ["data", "char*"],
      ["length", "u32", { lengthOf: "data" }],
    ] as const)

    const manualBuffer = new ArrayBuffer(StringStruct.size)
    const view = new DataView(manualBuffer)

    const fakePointer = 0x12345678
    if (process.arch === "x64" || process.arch === "arm64") {
      view.setBigUint64(0, BigInt(fakePointer), true)
    } else {
      view.setUint32(0, fakePointer, true)
    }

    view.setUint32(8, 0, true)

    const unpacked = StringStruct.unpack(manualBuffer)
    expect(unpacked.data).toBeNull()
    expect(unpacked.length).toBe(0)
  })

  it("should handle char* with valid pointer to real memory but zero length (u32)", () => {
    const StringStruct = defineStruct([
      ["data", "char*"],
      ["length", "u32", { lengthOf: "data" }],
    ] as const)

    const realData = new TextEncoder().encode("some actual data here")
    const realDataBuffer = new ArrayBuffer(realData.length)
    new Uint8Array(realDataBuffer).set(realData)

    const realPointer = ptr(realDataBuffer)

    const structBuffer = new ArrayBuffer(StringStruct.size)
    const view = new DataView(structBuffer)

    if (process.arch === "x64" || process.arch === "arm64") {
      view.setBigUint64(0, BigInt(realPointer), true)
    } else {
      view.setUint32(0, Number(realPointer), true)
    }

    view.setUint32(8, 0, true)

    const unpacked = StringStruct.unpack(structBuffer)
    expect(unpacked.data).toBeNull()
    expect(unpacked.length).toBe(0)
  })

  it("should handle char* with valid pointer to real memory but zero length (u64)", () => {
    const StringStruct = defineStruct([
      ["data", "char*"],
      ["length", "u64", { lengthOf: "data" }],
    ] as const)

    const realData = new TextEncoder().encode("some actual data here")
    const realDataBuffer = new ArrayBuffer(realData.length)
    new Uint8Array(realDataBuffer).set(realData)

    const realPointer = ptr(realDataBuffer)

    const structBuffer = new ArrayBuffer(StringStruct.size)
    const view = new DataView(structBuffer)

    if (process.arch === "x64" || process.arch === "arm64") {
      view.setBigUint64(0, BigInt(realPointer), true)
    } else {
      view.setUint32(0, Number(realPointer), true)
    }

    view.setBigUint64(8, 0n, true)

    const unpacked = StringStruct.unpack(structBuffer)
    expect(unpacked.data).toBeNull()
    expect(unpacked.length).toBe(0n)
  })
})
