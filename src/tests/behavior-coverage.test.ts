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

  it("preserves strict and zero-filled semantics for inline nested structs", () => {
    const InnerStruct = defineStruct([
      ["required", "u8"],
      ["optional", "u32", { optional: true }],
    ] as const)
    const OuterStruct = defineStruct([
      ["prefix", "u8"],
      ["inner", InnerStruct],
    ] as const)
    const buffer = new ArrayBuffer(OuterStruct.size)
    new Uint8Array(buffer).fill(0xff)

    OuterStruct.packInto({ prefix: 1, inner: { required: 2 } }, new DataView(buffer), 0)

    const innerOffset = OuterStruct.layoutByName.get("inner")!.offset
    expect([...new Uint8Array(buffer, innerOffset, InnerStruct.size)]).toEqual([2, 0, 0, 0, 0, 0, 0, 0])
    expect(OuterStruct.unpack(buffer).inner).toEqual({ required: 2, optional: 0 })
    expect(() => OuterStruct.pack({ prefix: 1, inner: {} } as any)).toThrow(
      "Packing non-optional field 'required' but value is undefined",
    )
  })

  it("preserves nested getter, override, and failed packInto behavior", () => {
    const InnerStruct = defineStruct([["value", "u32"]] as const)
    const OptionalOuterStruct = defineStruct([["inner", InnerStruct, { optional: true }]] as const)
    let getterCalls = 0
    const getterInput = Object.defineProperty({}, "inner", {
      enumerable: true,
      get() {
        getterCalls += 1
        return { value: 7 }
      },
    })
    expect(OptionalOuterStruct.unpack(OptionalOuterStruct.pack(getterInput as any)).inner?.value).toBe(7)
    expect(getterCalls).toBe(1)

    const RequiredOuterStruct = defineStruct([["inner", InnerStruct]] as const)
    const originalPack = InnerStruct.pack
    let packGetterCalls = 0
    let overrideCalls = 0
    Object.defineProperty(InnerStruct, "pack", {
      configurable: true,
      get() {
        packGetterCalls += 1
        const override = function (this: typeof InnerStruct, value: { value: number }, options?: any) {
          overrideCalls += 1
          return originalPack.call(this, value, options)
        }
        Object.defineProperty(override, "call", {
          value: () => {
            throw new Error("shadowed call must not be used")
          },
        })
        return override
      },
    })
    expect(RequiredOuterStruct.pack({ inner: { value: 8 } }).byteLength).toBe(RequiredOuterStruct.size)
    expect(packGetterCalls).toBe(1)
    expect(overrideCalls).toBe(1)

    const FailingInnerStruct = defineStruct([
      ["first", "u32"],
      [
        "second",
        "u32",
        {
          validate: () => {
            throw new Error("nested validation failed")
          },
        },
      ],
    ] as const)
    const FailingOuterStruct = defineStruct([["inner", FailingInnerStruct]] as const)
    const target = new ArrayBuffer(FailingOuterStruct.size)
    new Uint8Array(target).fill(0xaa)
    expect(() => FailingOuterStruct.packInto({ inner: { first: 1, second: 2 } }, new DataView(target), 0)).toThrow(
      "nested validation failed",
    )
    expect([...new Uint8Array(target)]).toEqual(Array(FailingOuterStruct.size).fill(0xaa))
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

  it("preserves primitive semantics after hot-path specialization", () => {
    const TestStruct = defineStruct([
      ["u8", "u8"],
      ["flag8", "bool_u8"],
      ["flag32", "bool_u32"],
      ["u16", "u16"],
      ["i16", "i16"],
      ["u32", "u32"],
      ["i32", "i32"],
      ["i64", "i64"],
      ["u64", "u64"],
      ["f32", "f32"],
      ["f64", "f64"],
    ] as const)
    const value = {
      u8: 250,
      flag8: true,
      flag32: false,
      u16: 60_000,
      i16: -12_345,
      u32: 4_000_000_000,
      i32: -2_000_000_000,
      i64: -9_000_000_000n,
      u64: 18_000_000_000n,
      f32: 1.25,
      f64: Math.PI,
    }

    let getterCalls = 0
    for (let index = 0; index < 255; index++) TestStruct.pack(value)
    const getterValue = Object.defineProperty({ ...value }, "u8", {
      enumerable: true,
      get() {
        getterCalls += 1
        return value.u8
      },
    })
    const packed = TestStruct.pack(getterValue)
    expect(getterCalls).toBe(1)

    let unpacked = TestStruct.unpack(packed)
    for (let index = 1; index < 256; index++) unpacked = TestStruct.unpack(packed)
    expect(unpacked).toEqual(value)

    const values = Array.from({ length: 256 }, (_, index) => ({ ...value, u8: index }))
    const packedList = TestStruct.packList(values)
    expect(TestStruct.unpackList(packedList, values.length)).toEqual(values)
    expect(() => TestStruct.pack({ ...value, u8: undefined } as any)).toThrow(
      "Packing non-optional field 'u8' but value is undefined",
    )
    expect(() => TestStruct.packList([value, { ...value, u16: undefined }] as any)).toThrow(
      "Packing non-optional field 'u16' at index 1 but value is undefined",
    )
  })

  it("keeps nested unpack overrides and callback snapshots on the fallback path", () => {
    const InnerStruct = defineStruct([
      [
        "first",
        "u32",
        {
          unpackTransform: (value: number) => {
            sourceView.setUint32(secondOffset, 99, true)
            return value
          },
        },
      ],
      ["second", "u32"],
    ] as const)
    const OuterStruct = defineStruct([["inner", InnerStruct]] as const)
    const source = OuterStruct.pack({ inner: { first: 1, second: 2 } })
    const sourceView = new DataView(source)
    const secondOffset = OuterStruct.layoutByName.get("inner")!.offset + InnerStruct.layoutByName.get("second")!.offset

    expect(OuterStruct.unpack(source).inner).toEqual({ first: 1, second: 2 })
    expect(sourceView.getUint32(secondOffset, true)).toBe(99)

    const PureInnerStruct = defineStruct([["value", "u32"]] as const)
    const PureOuterStruct = defineStruct([["inner", PureInnerStruct]] as const)
    const originalUnpack = PureInnerStruct.unpack
    let overrideCalls = 0
    Object.defineProperty(PureInnerStruct, "unpack", {
      configurable: true,
      get() {
        return function (this: typeof PureInnerStruct, buffer: ArrayBuffer) {
          overrideCalls += 1
          return originalUnpack.call(this, buffer)
        }
      },
    })
    expect(PureOuterStruct.unpack(PureOuterStruct.pack({ inner: { value: 7 } })).inner.value).toBe(7)
    expect(overrideCalls).toBe(1)
  })

  it("roundtrips safe numeric and bigint pointer values", () => {
    const PointerStruct = defineStruct([["value", "pointer"]] as const)
    for (const value of [0, 1, 0x100000001, 0x123456789abcn] as const) {
      expect(BigInt(PointerStruct.unpack(PointerStruct.pack({ value })).value)).toBe(BigInt(value))
    }
    expect(() => PointerStruct.pack({ value: 1.5 })).toThrow()
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
