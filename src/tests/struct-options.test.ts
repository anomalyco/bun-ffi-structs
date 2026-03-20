import { expect, describe, it } from "bun:test"
import { toArrayBuffer } from "bun:ffi"
import { defineStruct } from "../structs_ffi.js"

describe("struct options", () => {
  it("should apply mapValue transformation", () => {
    const TestStruct = defineStruct([["value", "u32"]] as const, {
      mapValue: (input: { doubled: number }) => ({ value: input.doubled * 2 }),
    })

    const input = { doubled: 21 }
    const packed = TestStruct.pack(input)
    const unpacked = TestStruct.unpack(packed)

    expect(unpacked.value).toBe(42)
  })

  it("should apply reduceValue transformation", () => {
    const StringStruct = defineStruct(
      [
        ["data", "char*"],
        ["length", "u64"],
      ] as const,
      {
        mapValue: (v: string) => ({
          data: v,
          length: Buffer.byteLength(v),
        }),
        reduceValue: (v: { data: number; length: bigint }) => {
          // @ts-ignore - toArrayBuffer pointer type issue
          const buffer = toArrayBuffer(v.data, 0, Number(v.length))
          return new TextDecoder().decode(buffer)
        },
      },
    )

    const testString = "Hello, World! 🌍"
    const packed = StringStruct.pack(testString)
    const unpacked = StringStruct.unpack(packed)

    // The unpacked value should be the original string (transformed by reduceValue)
    expect(typeof unpacked).toBe("string")
    expect(unpacked).toBe(testString)
  })

  it("should support both mapValue and reduceValue with different types", () => {
    interface Point3D {
      x: number
      y: number
      z: number
    }

    const Point3DStruct = defineStruct(
      [
        ["x", "f32"],
        ["y", "f32"],
        ["z", "f32"],
        ["magnitude", "f32"], // Computed field
      ] as const,
      {
        mapValue: (point: Point3D) => ({
          x: point.x,
          y: point.y,
          z: point.z,
          magnitude: Math.sqrt(point.x * point.x + point.y * point.y + point.z * point.z),
        }),
        reduceValue: (packed: { x: number; y: number; z: number; magnitude: number }) => ({
          x: packed.x,
          y: packed.y,
          z: packed.z,
          // Note: we can return a different structure or add computed properties
          length: packed.magnitude,
          normalized: {
            x: packed.x / packed.magnitude,
            y: packed.y / packed.magnitude,
            z: packed.z / packed.magnitude,
          },
        }),
      },
    )

    const inputPoint: Point3D = { x: 3, y: 4, z: 5 }
    const packed = Point3DStruct.pack(inputPoint)
    const unpacked = Point3DStruct.unpack(packed)

    // Verify the transformed output
    expect(unpacked.x).toBeCloseTo(3)
    expect(unpacked.y).toBeCloseTo(4)
    expect(unpacked.z).toBeCloseTo(5)
    expect(unpacked.length).toBeCloseTo(Math.sqrt(50)) // ~7.07
    expect(unpacked.normalized.x).toBeCloseTo(3 / Math.sqrt(50))
    expect(unpacked.normalized.y).toBeCloseTo(4 / Math.sqrt(50))
    expect(unpacked.normalized.z).toBeCloseTo(5 / Math.sqrt(50))
  })

  it("should work without reduceValue (normal struct behavior)", () => {
    const NormalStruct = defineStruct([
      ["a", "u32"],
      ["b", "f32"],
    ] as const)

    const input = { a: 42, b: 3.14 }
    const packed = NormalStruct.pack(input)
    const unpacked = NormalStruct.unpack(packed)

    // Should return the raw struct object
    expect(unpacked.a).toBe(42)
    expect(unpacked.b).toBeCloseTo(3.14)
    expect(typeof unpacked).toBe("object")
  })

  it("should handle nested structs with reduceValue transformations", () => {
    // Create a nested struct that transforms a coordinate pair into a complex number
    const ComplexNumberStruct = defineStruct(
      [
        ["real", "f32"],
        ["imaginary", "f32"],
      ] as const,
      {
        mapValue: (complex: { re: number; im: number }) => ({
          real: complex.re,
          imaginary: complex.im,
        }),
        reduceValue: (packed: { real: number; imaginary: number }) => ({
          re: packed.real,
          im: packed.imaginary,
          magnitude: Math.sqrt(packed.real * packed.real + packed.imaginary * packed.imaginary),
          phase: Math.atan2(packed.imaginary, packed.real),
          toString: () => `${packed.real} + ${packed.imaginary}i`,
        }),
      },
    )

    // Create a parent struct that contains the transformed nested struct
    const SignalStruct = defineStruct(
      [
        ["frequency", "f32"],
        ["amplitude", ComplexNumberStruct],
        ["timestamp", "u64"],
      ] as const,
      {
        reduceValue: (packed: { frequency: number; amplitude: any; timestamp: bigint }) => ({
          freq: packed.frequency,
          signal: packed.amplitude, // This should be the transformed complex number
          time: Number(packed.timestamp),
          powerLevel: packed.amplitude.magnitude * packed.frequency,
        }),
      },
    )

    const input = {
      frequency: 440.0, // A4 note
      amplitude: { re: 3.0, im: 4.0 }, // Complex number input
      timestamp: 1234567890n,
    }

    const packed = SignalStruct.pack(input)
    const unpacked = SignalStruct.unpack(packed)

    // Verify the outer transformation worked
    expect(unpacked.freq).toBeCloseTo(440.0)
    expect(unpacked.time).toBe(1234567890)
    expect(unpacked.powerLevel).toBeCloseTo(440.0 * 5.0) // magnitude of 3+4i is 5

    // Verify the nested struct transformation worked
    expect(unpacked.signal.re).toBeCloseTo(3.0)
    expect(unpacked.signal.im).toBeCloseTo(4.0)
    expect(unpacked.signal.magnitude).toBeCloseTo(5.0) // sqrt(3^2 + 4^2)
    expect(unpacked.signal.phase).toBeCloseTo(Math.atan2(4, 3))
    expect(typeof unpacked.signal.toString).toBe("function")
    expect(unpacked.signal.toString()).toBe("3 + 4i")
  })

  it("should handle multiple nested structs with different reduceValue transformations", () => {
    // Version struct that transforms to a string
    const VersionStruct = defineStruct(
      [
        ["major", "u32"],
        ["minor", "u32"],
        ["patch", "u32"],
      ] as const,
      {
        reduceValue: (v: { major: number; minor: number; patch: number }) => `${v.major}.${v.minor}.${v.patch}`,
      },
    )

    // Status struct that transforms to an enum-like object
    const StatusStruct = defineStruct(
      [
        ["code", "u32"],
        ["message", "char*"],
        ["severity", "u32"],
      ] as const,
      {
        mapValue: (status: { code: number; msg: string; level: number }) => ({
          code: status.code,
          message: status.msg,
          severity: status.level,
        }),
        reduceValue: (s: { code: number; message: number; severity: number }) => ({
          isOk: s.code === 0,
          isWarning: s.severity === 1,
          isError: s.severity === 2,
          statusCode: s.code,
          // Note: message is a pointer in the packed struct
          messagePtr: s.message,
        }),
      },
    )

    // Parent struct containing multiple transformed nested structs
    const ApplicationStruct = defineStruct([
      ["name", "cstring"],
      ["version", VersionStruct],
      ["status", StatusStruct],
      ["uptime", "u64"],
    ] as const)

    const input = {
      name: "MyApp",
      version: { major: 2, minor: 1, patch: 3 },
      status: { code: 0, msg: "OK", level: 0 },
      uptime: 86400n, // 1 day in seconds
    }

    const packed = ApplicationStruct.pack(input)
    const unpacked = ApplicationStruct.unpack(packed)

    // Verify the version was transformed to a string
    expect(typeof unpacked.version).toBe("string")
    expect(unpacked.version).toBe("2.1.3")

    // Verify the status was transformed to the enum-like object
    const transformedStatus = unpacked.status as {
      isOk: boolean
      isWarning: boolean
      isError: boolean
      statusCode: number
      messagePtr: number
    }
    expect(transformedStatus.isOk).toBe(true)
    expect(transformedStatus.isWarning).toBe(false)
    expect(transformedStatus.isError).toBe(false)
    expect(transformedStatus.statusCode).toBe(0)
    expect(typeof transformedStatus.messagePtr).toBe("number")

    // Verify other fields remain unchanged
    expect(unpacked.uptime).toBe(86400n)
  })

  it("should use struct-level defaults", () => {
    const TestStruct = defineStruct(
      [
        ["a", "u32"],
        ["b", "u32"],
      ] as const,
      {
        default: { a: 100, b: 200 },
      },
    )

    const packed = TestStruct.pack({ a: 10, b: 20 })
    const unpacked = TestStruct.unpack(packed)

    expect(unpacked.a).toBe(10)
    expect(unpacked.b).toBe(20)
  })

  it("should call mapValue for nested structs (WGPUStringView scenario)", () => {
    const mapValueCalls: any[] = []
    const WGPU_STRLEN = 0xffffffffffffffffn
    const WGPUStringView = defineStruct(
      [
        ["data", "char*", { optional: true }],
        ["length", "u64"],
      ] as const,
      {
        mapValue: (v: string | null | undefined) => {
          mapValueCalls.push({ type: "WGPUStringView", input: v })
          if (!v) {
            return {
              data: null,
              length: WGPU_STRLEN,
            }
          }
          return {
            data: v,
            length: Buffer.byteLength(v),
          }
        },
        reduceValue: (v: { data: number | null; length: bigint }) => {
          if (v.data === null || v.length === 0n) {
            return ""
          }
          // For test purposes, just return a mock string since we can't actually read memory
          return v.length === WGPU_STRLEN ? "" : `mock-string-${v.length}`
        },
      },
    )

    const WGPUVertexStateStruct = defineStruct([
      ["nextInChain", "pointer", { optional: true }],
      ["module", "pointer"], // Simplified for test
      ["entryPoint", WGPUStringView, { optional: true, mapOptionalInline: true }],
      ["constantCount", "u64", { default: 0 }],
      ["bufferCount", "u64", { default: 0 }],
    ] as const)

    mapValueCalls.length = 0

    const inputWithString = {
      module: 0x12345,
      entryPoint: "main",
    }

    const packedWithString = WGPUVertexStateStruct.pack(inputWithString)

    expect(mapValueCalls).toHaveLength(1)
    expect(mapValueCalls[0]).toEqual({
      type: "WGPUStringView",
      input: "main",
    })

    mapValueCalls.length = 0

    const inputWithNull = {
      module: 0x12345,
      entryPoint: null,
    }

    const packedWithNull = WGPUVertexStateStruct.pack(inputWithNull)

    expect(mapValueCalls).toHaveLength(1)
    expect(mapValueCalls[0]).toEqual({
      type: "WGPUStringView",
      input: undefined,
    })

    mapValueCalls.length = 0

    const inputWithUndefined = {
      module: 0x12345,
      // entryPoint is undefined/omitted
    }

    const packedWithUndefined = WGPUVertexStateStruct.pack(inputWithUndefined)

    // mapValue should still be called for optional fields when they have defaults
    // or when the struct itself needs to be packed
    expect(mapValueCalls).toHaveLength(1)
    expect(mapValueCalls[0]).toEqual({
      type: "WGPUStringView",
      input: undefined,
    })

    // Verify the packed buffers are valid (non-zero size)
    expect(packedWithString.byteLength).toBeGreaterThan(0)
    expect(packedWithNull.byteLength).toBeGreaterThan(0)
    expect(packedWithUndefined.byteLength).toBeGreaterThan(0)
  })

  it("should call mapValue for deeply nested structs", () => {
    const mapValueCalls: string[] = []

    // Level 3 struct with mapValue
    const Level3Struct = defineStruct([["value", "u32"]] as const, {
      mapValue: (input: { val: number }) => {
        mapValueCalls.push(`Level3: ${input.val}`)
        return { value: input.val * 2 }
      },
    })

    // Level 2 struct with mapValue, contains Level3
    const Level2Struct = defineStruct(
      [
        ["name", "cstring"],
        ["nested", Level3Struct],
      ] as const,
      {
        mapValue: (input: { title: string; data: { val: number } }) => {
          mapValueCalls.push(`Level2: ${input.title}`)
          return {
            name: input.title,
            nested: input.data,
          }
        },
      },
    )

    // Level 1 struct contains Level2
    const Level1Struct = defineStruct([
      ["id", "u32"],
      ["level2", Level2Struct],
    ] as const)

    mapValueCalls.length = 0

    const deepInput = {
      id: 42,
      level2: {
        title: "test",
        data: { val: 10 },
      },
    }

    const packed = Level1Struct.pack(deepInput)

    // Both mapValue functions should have been called
    expect(mapValueCalls).toHaveLength(2)
    expect(mapValueCalls).toContain("Level2: test")
    expect(mapValueCalls).toContain("Level3: 10")

    // Verify the nested transformations worked
    expect(packed.byteLength).toBeGreaterThan(0)
  })

  it("should call mapValue for struct arrays", () => {
    const mapValueCalls: Array<{ index: number; value: string }> = []

    // Item struct with mapValue transformation
    const ItemStruct = defineStruct(
      [
        ["name", "cstring"],
        ["value", "u32"],
      ] as const,
      {
        mapValue: (input: string) => {
          const callIndex = mapValueCalls.length
          mapValueCalls.push({ index: callIndex, value: input })
          return {
            name: input,
            value: input.length,
          }
        },
      },
    )

    // Container struct with array of items
    const ContainerStruct = defineStruct([
      ["itemCount", "u32", { lengthOf: "items" }],
      ["items", [ItemStruct]],
    ] as const)

    mapValueCalls.length = 0

    const arrayInput = {
      items: ["first", "second", "third"],
    }

    const packed = ContainerStruct.pack(arrayInput)

    // mapValue should be called for each array item
    expect(mapValueCalls).toHaveLength(3)
    expect(mapValueCalls[0]).toEqual({ index: 0, value: "first" })
    expect(mapValueCalls[1]).toEqual({ index: 1, value: "second" })
    expect(mapValueCalls[2]).toEqual({ index: 2, value: "third" })

    expect(packed.byteLength).toBeGreaterThan(0)
  })
})
