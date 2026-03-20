import { expect, describe, it } from "bun:test"
import { defineEnum, defineStruct } from "../structs_ffi.js"

describe("packList", () => {
  it("should pack a list of simple structs into a single buffer", () => {
    const TestStruct = defineStruct([
      ["x", "f32"],
      ["y", "f32"],
    ] as const)

    const objects = [
      { x: 1.0, y: 2.0 },
      { x: 3.0, y: 4.0 },
      { x: 5.0, y: 6.0 },
    ]

    const buffer = TestStruct.packList(objects)

    expect(buffer.byteLength).toBe(TestStruct.size * 3)

    const view = new DataView(buffer)
    expect(view.getFloat32(0, true)).toBeCloseTo(1.0)
    expect(view.getFloat32(4, true)).toBeCloseTo(2.0)
    expect(view.getFloat32(8, true)).toBeCloseTo(3.0)
    expect(view.getFloat32(12, true)).toBeCloseTo(4.0)
    expect(view.getFloat32(16, true)).toBeCloseTo(5.0)
    expect(view.getFloat32(20, true)).toBeCloseTo(6.0)
  })

  it("should pack an empty list into an empty buffer", () => {
    const TestStruct = defineStruct([
      ["value", "u32"],
      ["flag", "bool_u32"],
    ] as const)

    const buffer = TestStruct.packList([])

    expect(buffer.byteLength).toBe(0)
  })

  it("should pack a single item list", () => {
    const TestStruct = defineStruct([
      ["a", "u32"],
      ["b", "u32"],
    ] as const)

    const buffer = TestStruct.packList([{ a: 42, b: 84 }])

    expect(buffer.byteLength).toBe(TestStruct.size)

    const view = new DataView(buffer)
    expect(view.getUint32(0, true)).toBe(42)
    expect(view.getUint32(4, true)).toBe(84)
  })

  it("should pack structs with different primitive types", () => {
    const TestStruct = defineStruct([
      ["u8Val", "u8"],
      ["u32Val", "u32"],
      ["f64Val", "f64"],
    ] as const)

    const objects = [
      { u8Val: 255, u32Val: 0xdeadbeef, f64Val: 3.14159 },
      { u8Val: 128, u32Val: 0xcafebabe, f64Val: 2.71828 },
    ]

    const buffer = TestStruct.packList(objects)

    expect(buffer.byteLength).toBe(TestStruct.size * 2)

    const view = new DataView(buffer)
    expect(view.getUint8(0)).toBe(255)
    expect(view.getUint32(4, true)).toBe(0xdeadbeef)
    expect(view.getFloat64(8, true)).toBeCloseTo(3.14159)
    expect(view.getUint8(TestStruct.size)).toBe(128)
    expect(view.getUint32(TestStruct.size + 4, true)).toBe(0xcafebabe)
    expect(view.getFloat64(TestStruct.size + 8, true)).toBeCloseTo(2.71828)
  })

  it("should pack structs with enums", () => {
    const ColorEnum = defineEnum({
      RED: 0,
      GREEN: 1,
      BLUE: 2,
    })

    const TestStruct = defineStruct([
      ["id", "u32"],
      ["color", ColorEnum],
    ] as const)

    const objects = [
      { id: 1, color: "RED" as const },
      { id: 2, color: "GREEN" as const },
      { id: 3, color: "BLUE" as const },
    ]

    const buffer = TestStruct.packList(objects)

    expect(buffer.byteLength).toBe(TestStruct.size * 3)

    const view = new DataView(buffer)
    expect(view.getUint32(0, true)).toBe(1)
    expect(view.getUint32(4, true)).toBe(0)
    expect(view.getUint32(8, true)).toBe(2)
    expect(view.getUint32(12, true)).toBe(1)
    expect(view.getUint32(16, true)).toBe(3)
    expect(view.getUint32(20, true)).toBe(2)
  })

  it("should pack structs with nested inline structs", () => {
    const InnerStruct = defineStruct([
      ["x", "f32"],
      ["y", "f32"],
    ] as const)

    const OuterStruct = defineStruct([
      ["id", "u32"],
      ["position", InnerStruct],
    ] as const)

    const objects = [
      { id: 1, position: { x: 1.0, y: 2.0 } },
      { id: 2, position: { x: 3.0, y: 4.0 } },
    ]

    const buffer = OuterStruct.packList(objects)

    expect(buffer.byteLength).toBe(OuterStruct.size * 2)

    const view = new DataView(buffer)
    expect(view.getUint32(0, true)).toBe(1)
    expect(view.getFloat32(4, true)).toBeCloseTo(1.0)
    expect(view.getFloat32(8, true)).toBeCloseTo(2.0)
    expect(view.getUint32(12, true)).toBe(2)
    expect(view.getFloat32(16, true)).toBeCloseTo(3.0)
    expect(view.getFloat32(20, true)).toBeCloseTo(4.0)
  })

  it("should pack structs with optional fields using defaults", () => {
    const TestStruct = defineStruct([
      ["required", "u32"],
      ["optional", "u32", { optional: true, default: 42 }],
    ] as const)

    const objects = [{ required: 1 }, { required: 2, optional: 100 }, { required: 3 }]

    const buffer = TestStruct.packList(objects)

    expect(buffer.byteLength).toBe(TestStruct.size * 3)

    const view = new DataView(buffer)
    expect(view.getUint32(0, true)).toBe(1)
    expect(view.getUint32(4, true)).toBe(42)
    expect(view.getUint32(8, true)).toBe(2)
    expect(view.getUint32(12, true)).toBe(100)
    expect(view.getUint32(16, true)).toBe(3)
    expect(view.getUint32(20, true)).toBe(42)
  })

  it("should apply mapValue transformation to each item", () => {
    const TestStruct = defineStruct([["value", "u32"]] as const, {
      mapValue: (input: { doubled: number }) => ({ value: input.doubled * 2 }),
    })

    const objects = [{ doubled: 10 }, { doubled: 20 }, { doubled: 30 }]

    const buffer = TestStruct.packList(objects)

    expect(buffer.byteLength).toBe(TestStruct.size * 3)

    const view = new DataView(buffer)
    expect(view.getUint32(0, true)).toBe(20)
    expect(view.getUint32(4, true)).toBe(40)
    expect(view.getUint32(8, true)).toBe(60)
  })

  it("should validate each item in the list", () => {
    const TestStruct = defineStruct([
      [
        "value",
        "u32",
        {
          validate: (value, fieldName) => {
            if (value > 100) {
              throw new Error(`${fieldName} must be <= 100`)
            }
          },
        },
      ],
    ] as const)

    const validObjects = [{ value: 10 }, { value: 50 }, { value: 100 }]

    expect(() => TestStruct.packList(validObjects)).not.toThrow()

    const invalidObjects = [{ value: 10 }, { value: 150 }, { value: 50 }]

    expect(() => TestStruct.packList(invalidObjects)).toThrow("value must be <= 100")
  })

  it("should handle large lists efficiently", () => {
    const TestStruct = defineStruct([
      ["index", "u32"],
      ["value", "f64"],
    ] as const)

    const objects = Array.from({ length: 1000 }, (_, i) => ({
      index: i,
      value: Math.random() * 1000,
    }))

    const buffer = TestStruct.packList(objects)

    expect(buffer.byteLength).toBe(TestStruct.size * 1000)

    const view = new DataView(buffer)
    for (let i = 0; i < 1000; i++) {
      const offset = i * TestStruct.size
      expect(view.getUint32(offset, true)).toBe(i)
    }
  })

  it("should pack structs with booleans", () => {
    const TestStruct = defineStruct([
      ["flag8", "bool_u8"],
      ["flag32", "bool_u32"],
    ] as const)

    const objects = [
      { flag8: true, flag32: false },
      { flag8: false, flag32: true },
      { flag8: true, flag32: true },
    ]

    const buffer = TestStruct.packList(objects)

    expect(buffer.byteLength).toBe(TestStruct.size * 3)

    const view = new DataView(buffer)
    expect(view.getUint8(0)).toBe(1)
    expect(view.getUint32(4, true)).toBe(0)
    expect(view.getUint8(TestStruct.size)).toBe(0)
    expect(view.getUint32(TestStruct.size + 4, true)).toBe(1)
    expect(view.getUint8(TestStruct.size * 2)).toBe(1)
    expect(view.getUint32(TestStruct.size * 2 + 4, true)).toBe(1)
  })

  it("should pack complex structs with multiple nested levels", () => {
    const ColorStruct = defineStruct([
      ["r", "u8"],
      ["g", "u8"],
      ["b", "u8"],
      ["a", "u8"],
    ] as const)

    const ChunkStruct = defineStruct([
      ["text", "cstring"],
      ["fg", ColorStruct, { optional: true }],
      ["bg", ColorStruct, { optional: true }],
      ["attributes", "u32", { optional: true, default: 0 }],
    ] as const)

    const chunks = [
      {
        text: "Hello",
        fg: { r: 255, g: 0, b: 0, a: 255 },
        bg: { r: 0, g: 0, b: 0, a: 255 },
        attributes: 1,
      },
      {
        text: "World",
        fg: { r: 0, g: 255, b: 0, a: 255 },
      },
    ]

    const buffer = ChunkStruct.packList(chunks)

    expect(buffer.byteLength).toBe(ChunkStruct.size * 2)
  })

  it("should pack structs with bigint values", () => {
    const TestStruct = defineStruct([
      ["id", "u32"],
      ["timestamp", "u64"],
    ] as const)

    const objects = [
      { id: 1, timestamp: 1234567890n },
      { id: 2, timestamp: 9876543210n },
      { id: 3, timestamp: 5555555555n },
    ]

    const buffer = TestStruct.packList(objects)

    expect(buffer.byteLength).toBe(TestStruct.size * 3)

    const view = new DataView(buffer)
    expect(view.getUint32(0, true)).toBe(1)
    expect(view.getBigUint64(8, true)).toBe(1234567890n)
    expect(view.getUint32(16, true)).toBe(2)
    expect(view.getBigUint64(24, true)).toBe(9876543210n)
    expect(view.getUint32(32, true)).toBe(3)
    expect(view.getBigUint64(40, true)).toBe(5555555555n)
  })

  it("should throw error for missing required fields in any item", () => {
    const TestStruct = defineStruct([
      ["required1", "u32"],
      ["required2", "u32"],
    ] as const)

    const objects = [{ required1: 1, required2: 2 }, { required1: 3 } as any, { required1: 4, required2: 5 }]

    expect(() => TestStruct.packList(objects)).toThrow(
      "Packing non-optional field 'required2' at index 1 but value is undefined",
    )
  })

  it("should be equivalent to manual loop with packInto", () => {
    const TestStruct = defineStruct([
      ["a", "u32"],
      ["b", "f32"],
    ] as const)

    const objects = [
      { a: 1, b: 1.5 },
      { a: 2, b: 2.5 },
      { a: 3, b: 3.5 },
    ]

    const bufferFromPackList = TestStruct.packList(objects)

    const bufferFromManual = new ArrayBuffer(TestStruct.size * objects.length)
    const view = new DataView(bufferFromManual)
    for (let i = 0; i < objects.length; i++) {
      TestStruct.packInto(objects[i]!, view, i * TestStruct.size)
    }

    expect(bufferFromPackList.byteLength).toBe(bufferFromManual.byteLength)

    const viewFromPackList = new Uint8Array(bufferFromPackList)
    const viewFromManual = new Uint8Array(bufferFromManual)

    for (let i = 0; i < viewFromPackList.length; i++) {
      expect(viewFromPackList[i]).toBe(viewFromManual[i])
    }
  })

  it("should work with pack options including validation hints", () => {
    let capturedHints: any[] = []

    const TestStruct = defineStruct([
      [
        "value",
        "u32",
        {
          validate: (value, fieldName, options) => {
            capturedHints.push(options.hints)
            if (options.hints?.strict && value === 0) {
              throw new Error("Zero not allowed in strict mode")
            }
          },
        },
      ],
    ] as const)

    const objects = [{ value: 1 }, { value: 2 }, { value: 3 }]

    capturedHints = []
    TestStruct.packList(objects, { validationHints: { strict: false } })

    expect(capturedHints).toHaveLength(3)
    expect(capturedHints.every((h) => h?.strict === false)).toBe(true)

    const objectsWithZero = [{ value: 0 }, { value: 1 }]

    expect(() => TestStruct.packList(objectsWithZero, { validationHints: { strict: true } })).toThrow(
      "Zero not allowed in strict mode",
    )
  })
})

describe("unpackList", () => {
  it("should unpack a list of simple structs from a buffer", () => {
    const TestStruct = defineStruct([
      ["x", "f32"],
      ["y", "f32"],
    ] as const)

    const objects = [
      { x: 1.0, y: 2.0 },
      { x: 3.0, y: 4.0 },
      { x: 5.0, y: 6.0 },
    ]

    const buffer = TestStruct.packList(objects)
    const unpacked = TestStruct.unpackList(buffer, 3)

    expect(unpacked).toHaveLength(3)
    expect(unpacked[0]!.x).toBeCloseTo(1.0)
    expect(unpacked[0]!.y).toBeCloseTo(2.0)
    expect(unpacked[1]!.x).toBeCloseTo(3.0)
    expect(unpacked[1]!.y).toBeCloseTo(4.0)
    expect(unpacked[2]!.x).toBeCloseTo(5.0)
    expect(unpacked[2]!.y).toBeCloseTo(6.0)
  })

  it("should unpack an empty list from empty buffer", () => {
    const TestStruct = defineStruct([
      ["value", "u32"],
      ["flag", "bool_u32"],
    ] as const)

    const buffer = new ArrayBuffer(0)
    const unpacked = TestStruct.unpackList(buffer, 0)

    expect(unpacked).toHaveLength(0)
  })

  it("should unpack a single item", () => {
    const TestStruct = defineStruct([
      ["a", "u32"],
      ["b", "u32"],
    ] as const)

    const buffer = TestStruct.packList([{ a: 42, b: 84 }])
    const unpacked = TestStruct.unpackList(buffer, 1)

    expect(unpacked).toHaveLength(1)
    expect(unpacked[0]!.a).toBe(42)
    expect(unpacked[0]!.b).toBe(84)
  })

  it("should unpack structs with different primitive types", () => {
    const TestStruct = defineStruct([
      ["u8Val", "u8"],
      ["u32Val", "u32"],
      ["f64Val", "f64"],
    ] as const)

    const objects = [
      { u8Val: 255, u32Val: 0xdeadbeef, f64Val: 3.14159 },
      { u8Val: 128, u32Val: 0xcafebabe, f64Val: 2.71828 },
    ]

    const buffer = TestStruct.packList(objects)
    const unpacked = TestStruct.unpackList(buffer, 2)

    expect(unpacked).toHaveLength(2)
    expect(unpacked[0]!.u8Val).toBe(255)
    expect(unpacked[0]!.u32Val).toBe(0xdeadbeef)
    expect(unpacked[0]!.f64Val).toBeCloseTo(3.14159)
    expect(unpacked[1]!.u8Val).toBe(128)
    expect(unpacked[1]!.u32Val).toBe(0xcafebabe)
    expect(unpacked[1]!.f64Val).toBeCloseTo(2.71828)
  })

  it("should unpack structs with enums", () => {
    const ColorEnum = defineEnum({
      RED: 0,
      GREEN: 1,
      BLUE: 2,
    })

    const TestStruct = defineStruct([
      ["id", "u32"],
      ["color", ColorEnum],
    ] as const)

    const objects = [
      { id: 1, color: "RED" as const },
      { id: 2, color: "GREEN" as const },
      { id: 3, color: "BLUE" as const },
    ]

    const buffer = TestStruct.packList(objects)
    const unpacked = TestStruct.unpackList(buffer, 3)

    expect(unpacked).toHaveLength(3)
    expect(unpacked[0]!.id).toBe(1)
    expect(unpacked[0]!.color).toBe("RED")
    expect(unpacked[1]!.id).toBe(2)
    expect(unpacked[1]!.color).toBe("GREEN")
    expect(unpacked[2]!.id).toBe(3)
    expect(unpacked[2]!.color).toBe("BLUE")
  })

  it("should unpack structs with nested inline structs", () => {
    const InnerStruct = defineStruct([
      ["x", "f32"],
      ["y", "f32"],
    ] as const)

    const OuterStruct = defineStruct([
      ["id", "u32"],
      ["position", InnerStruct],
    ] as const)

    const objects = [
      { id: 1, position: { x: 1.0, y: 2.0 } },
      { id: 2, position: { x: 3.0, y: 4.0 } },
    ]

    const buffer = OuterStruct.packList(objects)
    const unpacked = OuterStruct.unpackList(buffer, 2)

    expect(unpacked).toHaveLength(2)
    expect(unpacked[0]!.id).toBe(1)
    expect(unpacked[0]!.position.x).toBeCloseTo(1.0)
    expect(unpacked[0]!.position.y).toBeCloseTo(2.0)
    expect(unpacked[1]!.id).toBe(2)
    expect(unpacked[1]!.position.x).toBeCloseTo(3.0)
    expect(unpacked[1]!.position.y).toBeCloseTo(4.0)
  })

  it("should unpack structs with optional fields using defaults", () => {
    const TestStruct = defineStruct([
      ["required", "u32"],
      ["optional", "u32", { optional: true, default: 42 }],
    ] as const)

    const objects = [{ required: 1 }, { required: 2, optional: 100 }, { required: 3 }]

    const buffer = TestStruct.packList(objects)
    const unpacked = TestStruct.unpackList(buffer, 3)

    expect(unpacked).toHaveLength(3)
    expect(unpacked[0]!.required).toBe(1)
    expect(unpacked[0]!.optional).toBe(42)
    expect(unpacked[1]!.required).toBe(2)
    expect(unpacked[1]!.optional).toBe(100)
    expect(unpacked[2]!.required).toBe(3)
    expect(unpacked[2]!.optional).toBe(42)
  })

  it("should apply reduceValue transformation to each item", () => {
    const TestStruct = defineStruct(
      [
        ["x", "f32"],
        ["y", "f32"],
      ] as const,
      {
        reduceValue: (v: { x: number; y: number }) => ({
          x: v.x,
          y: v.y,
          magnitude: Math.sqrt(v.x * v.x + v.y * v.y),
        }),
      },
    )

    const objects = [
      { x: 3.0, y: 4.0 },
      { x: 5.0, y: 12.0 },
    ]

    const buffer = TestStruct.packList(objects)
    const unpacked = TestStruct.unpackList(buffer, 2)

    expect(unpacked).toHaveLength(2)
    expect(unpacked[0]!.x).toBeCloseTo(3.0)
    expect(unpacked[0]!.y).toBeCloseTo(4.0)
    expect(unpacked[0]!.magnitude).toBeCloseTo(5.0)
    expect(unpacked[1]!.x).toBeCloseTo(5.0)
    expect(unpacked[1]!.y).toBeCloseTo(12.0)
    expect(unpacked[1]!.magnitude).toBeCloseTo(13.0)
  })

  it("should handle large lists efficiently", () => {
    const TestStruct = defineStruct([
      ["index", "u32"],
      ["value", "f64"],
    ] as const)

    const objects = Array.from({ length: 1000 }, (_, i) => ({
      index: i,
      value: i * 1.5,
    }))

    const buffer = TestStruct.packList(objects)
    const unpacked = TestStruct.unpackList(buffer, 1000)

    expect(unpacked).toHaveLength(1000)
    for (let i = 0; i < 1000; i++) {
      expect(unpacked[i]!.index).toBe(i)
      expect(unpacked[i]!.value).toBeCloseTo(i * 1.5)
    }
  })

  it("should unpack structs with booleans", () => {
    const TestStruct = defineStruct([
      ["flag8", "bool_u8"],
      ["flag32", "bool_u32"],
    ] as const)

    const objects = [
      { flag8: true, flag32: false },
      { flag8: false, flag32: true },
      { flag8: true, flag32: true },
    ]

    const buffer = TestStruct.packList(objects)
    const unpacked = TestStruct.unpackList(buffer, 3)

    expect(unpacked).toHaveLength(3)
    expect(unpacked[0]!.flag8).toBe(true)
    expect(unpacked[0]!.flag32).toBe(false)
    expect(unpacked[1]!.flag8).toBe(false)
    expect(unpacked[1]!.flag32).toBe(true)
    expect(unpacked[2]!.flag8).toBe(true)
    expect(unpacked[2]!.flag32).toBe(true)
  })

  it("should unpack structs with bigint values", () => {
    const TestStruct = defineStruct([
      ["id", "u32"],
      ["timestamp", "u64"],
    ] as const)

    const objects = [
      { id: 1, timestamp: 1234567890n },
      { id: 2, timestamp: 9876543210n },
      { id: 3, timestamp: 5555555555n },
    ]

    const buffer = TestStruct.packList(objects)
    const unpacked = TestStruct.unpackList(buffer, 3)

    expect(unpacked).toHaveLength(3)
    expect(unpacked[0]!.id).toBe(1)
    expect(unpacked[0]!.timestamp).toBe(1234567890n)
    expect(unpacked[1]!.id).toBe(2)
    expect(unpacked[1]!.timestamp).toBe(9876543210n)
    expect(unpacked[2]!.id).toBe(3)
    expect(unpacked[2]!.timestamp).toBe(5555555555n)
  })

  it("should throw error if buffer is too small", () => {
    const TestStruct = defineStruct([
      ["a", "u32"],
      ["b", "u32"],
    ] as const)

    const smallBuffer = new ArrayBuffer(TestStruct.size)

    expect(() => TestStruct.unpackList(smallBuffer, 3)).toThrow(
      `Buffer size (${TestStruct.size}) is smaller than expected size (${TestStruct.size * 3})`,
    )
  })

  it("should be equivalent to multiple unpack calls", () => {
    const TestStruct = defineStruct([
      ["a", "u32"],
      ["b", "f32"],
    ] as const)

    const objects = [
      { a: 1, b: 1.5 },
      { a: 2, b: 2.5 },
      { a: 3, b: 3.5 },
    ]

    const buffer = TestStruct.packList(objects)

    const unpackedList = TestStruct.unpackList(buffer, 3)
    const unpackedIndividual = []
    for (let i = 0; i < 3; i++) {
      const slice = buffer.slice(i * TestStruct.size, (i + 1) * TestStruct.size)
      unpackedIndividual.push(TestStruct.unpack(slice))
    }

    expect(unpackedList).toHaveLength(3)
    expect(unpackedIndividual).toHaveLength(3)

    for (let i = 0; i < 3; i++) {
      expect(unpackedList[i]!.a).toBe(unpackedIndividual[i]!.a)
      expect(unpackedList[i]!.b).toBeCloseTo(unpackedIndividual[i]!.b)
    }
  })

  it("should handle nested structs with multiple levels", () => {
    const Vec3Struct = defineStruct([
      ["x", "f32"],
      ["y", "f32"],
      ["z", "f32"],
    ] as const)

    const ParticleStruct = defineStruct([
      ["id", "u32"],
      ["position", Vec3Struct],
      ["velocity", Vec3Struct],
    ] as const)

    const particles = [
      { id: 1, position: { x: 0, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 } },
      { id: 2, position: { x: 5, y: 0, z: 0 }, velocity: { x: 0, y: 1, z: 0 } },
      { id: 3, position: { x: 0, y: 5, z: 0 }, velocity: { x: 0, y: 0, z: 1 } },
    ]

    const buffer = ParticleStruct.packList(particles)
    const unpacked = ParticleStruct.unpackList(buffer, 3)

    expect(unpacked).toHaveLength(3)

    expect(unpacked[0]!.id).toBe(1)
    expect(unpacked[0]!.position.x).toBeCloseTo(0)
    expect(unpacked[0]!.velocity.x).toBeCloseTo(1)

    expect(unpacked[1]!.id).toBe(2)
    expect(unpacked[1]!.position.x).toBeCloseTo(5)
    expect(unpacked[1]!.velocity.y).toBeCloseTo(1)

    expect(unpacked[2]!.id).toBe(3)
    expect(unpacked[2]!.position.y).toBeCloseTo(5)
    expect(unpacked[2]!.velocity.z).toBeCloseTo(1)
  })

  it("should handle struct-level defaults", () => {
    const TestStruct = defineStruct(
      [
        ["a", "u32"],
        ["b", "u32"],
      ] as const,
      {
        default: { a: 100, b: 200 },
      },
    )

    const objects = [
      { a: 10, b: 20 },
      { a: 30, b: 40 },
    ]

    const buffer = TestStruct.packList(objects)
    const unpacked = TestStruct.unpackList(buffer, 2)

    expect(unpacked).toHaveLength(2)
    expect(unpacked[0]!.a).toBe(10)
    expect(unpacked[0]!.b).toBe(20)
    expect(unpacked[1]!.a).toBe(30)
    expect(unpacked[1]!.b).toBe(40)
  })

  it("should handle both mapValue and reduceValue transformations", () => {
    const TestStruct = defineStruct(
      [
        ["x", "f32"],
        ["y", "f32"],
      ] as const,
      {
        mapValue: (v: { pos: { x: number; y: number } }) => v.pos,
        reduceValue: (v: { x: number; y: number }) => ({
          position: v,
          distance: Math.sqrt(v.x * v.x + v.y * v.y),
        }),
      },
    )

    const objects = [{ pos: { x: 3, y: 4 } }, { pos: { x: 5, y: 12 } }]

    const buffer = TestStruct.packList(objects)
    const unpacked = TestStruct.unpackList(buffer, 2)

    expect(unpacked).toHaveLength(2)
    expect(unpacked[0]!.position.x).toBeCloseTo(3)
    expect(unpacked[0]!.position.y).toBeCloseTo(4)
    expect(unpacked[0]!.distance).toBeCloseTo(5)
    expect(unpacked[1]!.position.x).toBeCloseTo(5)
    expect(unpacked[1]!.position.y).toBeCloseTo(12)
    expect(unpacked[1]!.distance).toBeCloseTo(13)
  })

  it("should handle i16 and i32 signed integers", () => {
    const TestStruct = defineStruct([
      ["i16Val", "i16"],
      ["i32Val", "i32"],
    ] as const)

    const objects = [
      { i16Val: -32768, i32Val: -2147483648 },
      { i16Val: 32767, i32Val: 2147483647 },
      { i16Val: 0, i32Val: 0 },
    ]

    const buffer = TestStruct.packList(objects)
    const unpacked = TestStruct.unpackList(buffer, 3)

    expect(unpacked).toHaveLength(3)
    expect(unpacked[0]!.i16Val).toBe(-32768)
    expect(unpacked[0]!.i32Val).toBe(-2147483648)
    expect(unpacked[1]!.i16Val).toBe(32767)
    expect(unpacked[1]!.i32Val).toBe(2147483647)
    expect(unpacked[2]!.i16Val).toBe(0)
    expect(unpacked[2]!.i32Val).toBe(0)
  })

  it("should unpack partial buffer when count is less than full capacity", () => {
    const TestStruct = defineStruct([["value", "u32"]] as const)

    const objects = [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }]

    const buffer = TestStruct.packList(objects)

    const unpacked = TestStruct.unpackList(buffer, 3)

    expect(unpacked).toHaveLength(3)
    expect(unpacked[0]!.value).toBe(1)
    expect(unpacked[1]!.value).toBe(2)
    expect(unpacked[2]!.value).toBe(3)
  })
})

describe("packList and unpackList roundtrip", () => {
  it("should roundtrip simple structs", () => {
    const TestStruct = defineStruct([
      ["a", "u32"],
      ["b", "f32"],
      ["c", "bool_u32"],
    ] as const)

    const original = [
      { a: 1, b: 1.5, c: true },
      { a: 2, b: 2.5, c: false },
      { a: 3, b: 3.5, c: true },
    ]

    const buffer = TestStruct.packList(original)
    const unpacked = TestStruct.unpackList(buffer, original.length)

    expect(unpacked).toHaveLength(original.length)
    for (let i = 0; i < original.length; i++) {
      expect(unpacked[i]!.a).toBe(original[i]!.a)
      expect(unpacked[i]!.b).toBeCloseTo(original[i]!.b)
      expect(unpacked[i]!.c).toBe(original[i]!.c)
    }
  })

  it("should roundtrip complex nested structs", () => {
    const ColorStruct = defineStruct([
      ["r", "u8"],
      ["g", "u8"],
      ["b", "u8"],
      ["a", "u8"],
    ] as const)

    const PositionStruct = defineStruct([
      ["x", "f32"],
      ["y", "f32"],
    ] as const)

    const EntityStruct = defineStruct([
      ["id", "u32"],
      ["position", PositionStruct],
      ["color", ColorStruct],
      ["health", "f32"],
    ] as const)

    const original = [
      { id: 1, position: { x: 10, y: 20 }, color: { r: 255, g: 0, b: 0, a: 255 }, health: 100 },
      { id: 2, position: { x: 30, y: 40 }, color: { r: 0, g: 255, b: 0, a: 255 }, health: 75.5 },
      { id: 3, position: { x: 50, y: 60 }, color: { r: 0, g: 0, b: 255, a: 255 }, health: 50.25 },
    ]

    const buffer = EntityStruct.packList(original)
    const unpacked = EntityStruct.unpackList(buffer, original.length)

    expect(unpacked).toHaveLength(original.length)
    for (let i = 0; i < original.length; i++) {
      expect(unpacked[i]!.id).toBe(original[i]!.id)
      expect(unpacked[i]!.position.x).toBeCloseTo(original[i]!.position.x)
      expect(unpacked[i]!.position.y).toBeCloseTo(original[i]!.position.y)
      expect(unpacked[i]!.color.r).toBe(original[i]!.color.r)
      expect(unpacked[i]!.color.g).toBe(original[i]!.color.g)
      expect(unpacked[i]!.color.b).toBe(original[i]!.color.b)
      expect(unpacked[i]!.color.a).toBe(original[i]!.color.a)
      expect(unpacked[i]!.health).toBeCloseTo(original[i]!.health)
    }
  })

  it("should roundtrip with enums", () => {
    const StatusEnum = defineEnum({
      IDLE: 0,
      ACTIVE: 1,
      DISABLED: 2,
    })

    const TestStruct = defineStruct([
      ["id", "u32"],
      ["status", StatusEnum],
    ] as const)

    const original = [
      { id: 1, status: "IDLE" as const },
      { id: 2, status: "ACTIVE" as const },
      { id: 3, status: "DISABLED" as const },
    ]

    const buffer = TestStruct.packList(original)
    const unpacked = TestStruct.unpackList(buffer, original.length)

    expect(unpacked).toHaveLength(original.length)
    for (let i = 0; i < original.length; i++) {
      expect(unpacked[i]!.id).toBe(original[i]!.id)
      expect(unpacked[i]!.status).toBe(original[i]!.status)
    }
  })

  it("should roundtrip with defaults", () => {
    const TestStruct = defineStruct([
      ["required", "u32"],
      ["optional1", "f32", { optional: true, default: 1.5 }],
      ["optional2", "u32", { optional: true, default: 42 }],
    ] as const)

    const original = [
      { required: 1 },
      { required: 2, optional1: 2.5 },
      { required: 3, optional2: 100 },
      { required: 4, optional1: 3.5, optional2: 200 },
    ]

    const buffer = TestStruct.packList(original)
    const unpacked = TestStruct.unpackList(buffer, original.length)

    expect(unpacked).toHaveLength(original.length)
    expect(unpacked[0]!.required).toBe(1)
    expect(unpacked[0]!.optional1).toBeCloseTo(1.5)
    expect(unpacked[0]!.optional2).toBe(42)

    expect(unpacked[1]!.required).toBe(2)
    expect(unpacked[1]!.optional1).toBeCloseTo(2.5)
    expect(unpacked[1]!.optional2).toBe(42)

    expect(unpacked[2]!.required).toBe(3)
    expect(unpacked[2]!.optional1).toBeCloseTo(1.5)
    expect(unpacked[2]!.optional2).toBe(100)

    expect(unpacked[3]!.required).toBe(4)
    expect(unpacked[3]!.optional1).toBeCloseTo(3.5)
    expect(unpacked[3]!.optional2).toBe(200)
  })

  it("should roundtrip empty list", () => {
    const TestStruct = defineStruct([["value", "u32"]] as const)

    const original: { value: number }[] = []

    const buffer = TestStruct.packList(original)
    const unpacked = TestStruct.unpackList(buffer, original.length)

    expect(unpacked).toHaveLength(0)
  })
})
