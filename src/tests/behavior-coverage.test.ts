import { describe, expect, it } from "bun:test"
import { ptr, toArrayBuffer } from "../ffi.js"
import { allocStruct, defineEnum, defineStruct, objectPtr, pointerSize } from "../structs_ffi.js"
import type { Pointer } from "../types.js"

function readPointer(view: DataView, offset: number): bigint {
  return pointerSize === 8 ? view.getBigUint64(offset, true) : BigInt(view.getUint32(offset, true))
}

describe("behavior coverage", () => {
  it("roundtrips enum arrays through every custom primitive base", () => {
    const cases = [
      { base: "u16", first: 0, second: 65535 },
      { base: "i16", first: -32768, second: 32767 },
      { base: "i32", first: -2147483648, second: 2147483647 },
      { base: "u64", first: 0, second: 42 },
      { base: "i64", first: -42, second: 42 },
      { base: "f32", first: 1, second: 2 },
      { base: "f64", first: 1, second: 2 },
      { base: "pointer", first: 0, second: 4096 },
    ] as const

    for (const { base, first, second } of cases) {
      const TestEnum = defineEnum({ FIRST: first, SECOND: second }, base)
      const TestStruct = defineStruct([
        ["count", "u32", { lengthOf: "values" }],
        ["values", [TestEnum]],
      ] as const)

      const unpacked = TestStruct.unpack(TestStruct.pack({ values: ["FIRST", "SECOND"] }))
      expect(unpacked.count).toBe(2)
      expect(unpacked.values).toEqual(["FIRST", "SECOND"])
    }
  })

  it("applies scalar packTransform and enum-array unpackTransform", () => {
    const Status = defineEnum({ READY: 1, DONE: 2 }, "u8")
    const TestStruct = defineStruct([
      [
        "ageInMonths",
        "u16",
        {
          packTransform: (years: number) => years * 12,
          unpackTransform: (months: number) => months / 12,
        },
      ],
      ["statusCount", "u32", { lengthOf: "statuses" }],
      ["statuses", [Status], { unpackTransform: (values: string[]) => values.join(",") }],
    ] as const)

    const packed = TestStruct.pack({ ageInMonths: 25.5, statuses: ["READY", "DONE"] })
    expect(new DataView(packed).getUint16(0, true)).toBe(306)
    expect(TestStruct.unpack(packed)).toEqual({
      ageInMonths: 25.5,
      statusCount: 2,
      statuses: "READY,DONE",
    })
  })

  it("allocates array fields when the array precedes its length field", () => {
    const TestStruct = defineStruct([
      ["items", ["u32"]],
      ["itemCount", "u32", { lengthOf: "items" }],
    ] as const)

    const { buffer, subBuffers } = allocStruct(TestStruct, { lengths: { items: 3 } })
    const items = subBuffers!.items!
    const itemsView = new DataView(items)
    itemsView.setUint32(0, 10, true)
    itemsView.setUint32(4, 20, true)
    itemsView.setUint32(8, 30, true)

    expect(TestStruct.unpack(buffer)).toEqual({ items: [10, 20, 30], itemCount: 3 })
  })

  it("writes zero for a missing required u32 in packInto", () => {
    const TestStruct = defineStruct([["value", "u32"]] as const)
    const buffer = new ArrayBuffer(TestStruct.size)
    new Uint8Array(buffer).fill(0xff)

    expect(() => TestStruct.packInto({} as any, new DataView(buffer), 0)).not.toThrow()
    expect(TestStruct.unpack(buffer).value).toBe(0)
  })

  it("packs and unpacks raw object pointers", () => {
    interface TestObject {
      ptr: Pointer | null
    }

    const TestStruct = defineStruct([["object", objectPtr<TestObject>()]] as const)
    const packed = TestStruct.pack({ object: { ptr: 0x12345678 } })
    const field = TestStruct.layoutByName.get("object")!

    expect(readPointer(new DataView(packed), field.offset)).toBe(0x12345678n)
    expect(BigInt(TestStruct.unpack(packed).object)).toBe(0x12345678n)
  })

  it("packs object-pointer array fields into pointer arrays", () => {
    interface TestObject {
      ptr: Pointer | null
    }

    const TestStruct = defineStruct([
      ["objectCount", "u32", { lengthOf: "objects" }],
      ["objects", [objectPtr<TestObject>()]],
    ] as const)
    const packed = TestStruct.pack({ objects: [{ ptr: 0x1000 }, null, { ptr: 0x3000 }] })
    const view = new DataView(packed)
    const pointerField = TestStruct.layoutByName.get("objects")!
    const objectsPointer = readPointer(view, pointerField.offset)
    const objectsView = new DataView(toArrayBuffer(objectsPointer, 0, pointerSize * 3))

    expect(view.getUint32(TestStruct.layoutByName.get("objectCount")!.offset, true)).toBe(3)
    expect(readPointer(objectsView, 0)).toBe(0x1000n)
    expect(readPointer(objectsView, pointerSize)).toBe(0n)
    expect(readPointer(objectsView, pointerSize * 2)).toBe(0x3000n)
  })

  it("packs empty enum and object-pointer arrays as null pointers", () => {
    const TestEnum = defineEnum({ A: 1 }, "u8")
    const EnumArray = defineStruct([
      ["count", "u32", { lengthOf: "values" }],
      ["values", [TestEnum]],
    ] as const)
    const enumPacked = EnumArray.pack({ values: [] })
    expect(EnumArray.unpack(enumPacked)).toEqual({ count: 0, values: [] })
    expect(readPointer(new DataView(enumPacked), EnumArray.layoutByName.get("values")!.offset)).toBe(0n)

    interface TestObject {
      ptr: Pointer | null
    }
    const ObjectArray = defineStruct([
      ["count", "u32", { lengthOf: "values" }],
      ["values", [objectPtr<TestObject>()]],
    ] as const)
    const objectPacked = ObjectArray.pack({ values: [] })
    expect(new DataView(objectPacked).getUint32(ObjectArray.layoutByName.get("count")!.offset, true)).toBe(0)
    expect(readPointer(new DataView(objectPacked), ObjectArray.layoutByName.get("values")!.offset)).toBe(0n)
  })

  it("packs cstrings with a terminator and unpacks their raw pointers", () => {
    const CStringStruct = defineStruct([["value", "cstring"]] as const)
    const text = "hello"
    const packed = CStringStruct.pack({ value: text })
    const unpackedPointer: Pointer = CStringStruct.unpack(packed).value
    const bytes = new Uint8Array(toArrayBuffer(unpackedPointer, 0, Buffer.byteLength(text) + 1))

    expect([...bytes]).toEqual([...new TextEncoder().encode(text), 0])

    const OptionalCStringStruct = defineStruct([["value", "cstring", { optional: true }]] as const)
    const nullPacked = OptionalCStringStruct.pack({ value: null })
    expect(readPointer(new DataView(nullPacked), 0)).toBe(0n)
    expect(BigInt(OptionalCStringStruct.unpack(nullPacked).value ?? 0)).toBe(0n)
  })

  it("preserves documented unsupported unpack errors", () => {
    const ChildStruct = defineStruct([["value", "u32"]] as const)
    const PointerStruct = defineStruct([["child", ChildStruct, { asPointer: true }]] as const)
    const OptionalPointerStruct = defineStruct([["child", ChildStruct, { asPointer: true, optional: true }]] as const)
    const StructArray = defineStruct([
      ["count", "u32", { lengthOf: "items" }],
      ["items", [ChildStruct]],
    ] as const)

    interface TestObject {
      ptr: Pointer | null
    }
    const ObjectArray = defineStruct([
      ["count", "u32", { lengthOf: "items" }],
      ["items", [objectPtr<TestObject>()]],
    ] as const)

    expect(() => PointerStruct.unpack(PointerStruct.pack({ child: { value: 1 } }))).toThrow()
    expect(readPointer(new DataView(OptionalPointerStruct.pack({})), 0)).toBe(0n)
    expect(() => StructArray.unpack(StructArray.pack({ items: [{ value: 1 }] }))).toThrow()
    expect(() => ObjectArray.unpack(ObjectArray.pack({ items: [{ ptr: 0x1000 }] }))).toThrow()
  })

  it("reports invalid definitions and null array pointers with positive lengths", () => {
    expect(() => defineStruct([["values", ["u32"]]] as const)).toThrow(
      "lengthOf field not found for array field values",
    )
    expect(() => defineStruct([["value", "unsupported"]] as any)).toThrow("Unsupported field type for value")
    expect(() => defineStruct([["values", ["unsupported"]]] as any)).toThrow(
      "Unsupported array element type for values",
    )

    const PrimitiveArray = defineStruct([
      ["count", "u32", { lengthOf: "values" }],
      ["values", ["u32"]],
    ] as const)
    const primitiveBuffer = new ArrayBuffer(PrimitiveArray.size)
    new DataView(primitiveBuffer).setUint32(PrimitiveArray.layoutByName.get("count")!.offset, 1, true)
    expect(() => PrimitiveArray.unpack(primitiveBuffer)).toThrow("null pointer but length 1")
    expect(() => allocStruct(PrimitiveArray, { lengths: { missing: 1 } })).toThrow(
      "Field 'missing' is not an array field with a lengthOf field",
    )

    const TestEnum = defineEnum({ A: 1 })
    const EnumArray = defineStruct([
      ["count", "u32", { lengthOf: "values" }],
      ["values", [TestEnum]],
    ] as const)
    const enumBuffer = new ArrayBuffer(EnumArray.size)
    new DataView(enumBuffer).setUint32(EnumArray.layoutByName.get("count")!.offset, 1, true)
    expect(() => EnumArray.unpack(enumBuffer)).toThrow("null pointer but length 1")
  })

  it("unpacks structs and lists from SharedArrayBuffer", () => {
    const TestStruct = defineStruct([
      ["id", "u32"],
      ["value", "f64"],
    ] as const)

    const packed = TestStruct.pack({ id: 1, value: 2.5 })
    const shared = new SharedArrayBuffer(packed.byteLength)
    new Uint8Array(shared).set(new Uint8Array(packed))
    expect(TestStruct.unpack(shared)).toEqual({ id: 1, value: 2.5 })

    const packedList = TestStruct.packList([
      { id: 2, value: 3.5 },
      { id: 3, value: 4.5 },
    ])
    const sharedList = new SharedArrayBuffer(packedList.byteLength)
    new Uint8Array(sharedList).set(new Uint8Array(packedList))
    expect(TestStruct.unpackList(sharedList, 2)).toEqual([
      { id: 2, value: 3.5 },
      { id: 3, value: 4.5 },
    ])
  })

  it("passes the mapped input object to validators", () => {
    const inputs: any[] = []
    const TestStruct = defineStruct(
      [
        [
          "value",
          "u32",
          {
            validate: (_value, _field, options) => inputs.push(options.input),
          },
        ],
      ] as const,
      {
        mapValue: (input: { raw: number }) => ({ value: input.raw }),
      },
    )

    const packedInput = { raw: 1 }
    const intoInput = { raw: 2 }
    const listInputs = [{ raw: 3 }, { raw: 4 }]
    TestStruct.pack(packedInput)
    TestStruct.packInto(intoInput, new DataView(new ArrayBuffer(TestStruct.size)), 0)
    TestStruct.packList(listInputs)

    expect(inputs).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }])
  })

  it("retains struct-level default properties during unpacking", () => {
    const TestStruct = defineStruct([["value", "u32"]] as const, {
      default: { source: "default" },
      reduceValue: (value: { value: number; source: string }) => value,
    })

    expect(TestStruct.unpack(TestStruct.pack({ value: 1 }))).toEqual({ source: "default", value: 1 })
    expect(TestStruct.unpackList(TestStruct.packList([{ value: 2 }, { value: 3 }]), 2)).toEqual([
      { source: "default", value: 2 },
      { source: "default", value: 3 },
    ])
  })

  it("keeps mapped and reduced inference aligned with runtime values", () => {
    const TestStruct = defineStruct([["value", "u32"]] as const, {
      mapValue: (input: { raw: number }) => ({ value: input.raw }),
      reduceValue: (output: { value: number }) => ({ doubled: output.value * 2 }),
    })

    const output: { doubled: number } = TestStruct.unpack(TestStruct.pack({ raw: 4 }))
    expect(output).toEqual({ doubled: 8 })

    interface TestObject {
      ptr: Pointer | null
    }
    const ObjectStruct = defineStruct([["value", objectPtr<TestObject>()]] as const)
    const objectPointer: Pointer = ObjectStruct.unpack(ObjectStruct.pack({ value: { ptr: 0x1234 } })).value
    expect(BigInt(objectPointer)).toBe(0x1234n)
  })
})
