import { describe, expect, test } from "bun:test"
import { defineStruct } from "../structs_ffi.js"

describe("reusable storage", () => {
  test("unpackInto reuses the target and supports offset DataViews after specialization", () => {
    const TestStruct = defineStruct([
      ["id", "u32"],
      ["value", "f64"],
      ["timestamp", "u64"],
      ["active", "bool_u8"],
    ] as const)
    const value = { id: 7, value: 2.5, timestamp: 9n, active: true }
    const packed = TestStruct.pack(value)
    const storage = new ArrayBuffer(TestStruct.size + 12)
    new Uint8Array(storage, 6, TestStruct.size).set(new Uint8Array(packed))
    const view = new DataView(storage, 2, TestStruct.size + 8)
    const target: Record<string, unknown> = { extra: "kept" }

    for (let index = 0; index < 256; index++) {
      TestStruct.unpackInto(view, target, 4)
    }

    expect(TestStruct.unpackInto(view, target, 4)).toBe(target as any)
    expect(target).toEqual({ ...value, extra: "kept" })
  })

  test("unpackInto reapplies defaults and transforms without invoking mapValue", () => {
    let mapCalls = 0
    const TestStruct = defineStruct([["value", "u32", { unpackTransform: (value: number) => value * 2 }]] as const, {
      default: { source: "default" },
      mapValue: (value: { raw: number }) => {
        mapCalls += 1
        return { value: value.raw }
      },
    })
    const packed = TestStruct.pack({ raw: 4 })
    const target: Record<string, unknown> = { source: "stale" }

    expect(TestStruct.unpackInto(new DataView(packed), target)).toBe(target as any)
    expect(target).toEqual({ source: "default", value: 8 })
    expect(mapCalls).toBe(1)
  })

  test("unpackInto validates the complete range before mutating", () => {
    const TestStruct = defineStruct([
      ["a", "u32"],
      ["b", "u32"],
    ] as const)
    const target = { a: 10, b: 20 }
    const view = new DataView(new ArrayBuffer(TestStruct.size))

    expect(() => TestStruct.unpackInto(view, target, -1)).toThrow(RangeError)
    expect(() => TestStruct.unpackInto(view, target, 1)).toThrow(RangeError)
    expect(target).toEqual({ a: 10, b: 20 })
  })

  test("reduced definitions do not expose unpackInto", () => {
    const ReducedStruct = defineStruct([["value", "u32"]] as const, {
      reduceValue: (value: { value: number }) => value.value,
    })

    expect("unpackInto" in ReducedStruct).toBe(false)
    // @ts-expect-error reduced outputs cannot be filled into a reusable raw object
    if (false) ReducedStruct.unpackInto(new DataView(new ArrayBuffer(ReducedStruct.size)), {})
  })

  test("compiled packInto preserves offsets, getter counts, and bytes", () => {
    const TestStruct = defineStruct([
      ["id", "u32"],
      ["value", "f64"],
      ["timestamp", "u64"],
      ["active", "bool_u8"],
    ] as const)
    const value = { id: 7, value: 2.5, timestamp: 9n, active: true }
    const storage = new ArrayBuffer(TestStruct.size + 12)
    new Uint8Array(storage).fill(0xaa)
    const view = new DataView(storage, 2, TestStruct.size + 8)

    for (let index = 0; index < 255; index++) TestStruct.packInto(value, view, 4)

    let getterCalls = 0
    const getterValue = Object.defineProperty({ ...value }, "id", {
      enumerable: true,
      get() {
        getterCalls += 1
        return value.id
      },
    })
    TestStruct.packInto(getterValue, view, 4)

    expect(getterCalls).toBe(1)
    expect(TestStruct.unpack(storage.slice(6, 6 + TestStruct.size))).toEqual(value)
    expect([...new Uint8Array(storage, 0, 6)]).toEqual(Array(6).fill(0xaa))
    expect([...new Uint8Array(storage, 6 + TestStruct.size)]).toEqual(Array(6).fill(0xaa))
  })

  test("compiled packInto preserves missing-field warning behavior", () => {
    const TestStruct = defineStruct([["value", "u32"]] as const)
    const buffer = new ArrayBuffer(TestStruct.size)
    new Uint8Array(buffer).fill(0xff)
    const view = new DataView(buffer)
    for (let index = 0; index < 255; index++) TestStruct.packInto({ value: 1 }, view, 0)

    const originalWarn = console.warn
    const warnings: unknown[][] = []
    console.warn = (...args) => warnings.push(args)
    try {
      TestStruct.packInto({} as any, view, 0)
    } finally {
      console.warn = originalWarn
    }

    expect(warnings).toHaveLength(1)
    expect(String(warnings[0]?.[0])).toContain("packInto missing value for non-optional field 'value' at offset 0")
    expect(view.getUint32(0, true)).toBe(0)
  })

  test("packListInto matches packList and writes at a caller offset", () => {
    const TestStruct = defineStruct([
      ["id", "u32"],
      ["value", "f64"],
    ] as const)
    const values = Array.from({ length: 256 }, (_, index) => ({ id: index, value: index + 0.5 }))
    const expected = TestStruct.packList(values)
    const storage = new ArrayBuffer(expected.byteLength + 10)
    new Uint8Array(storage, 0, 5).fill(0xcc)
    new Uint8Array(storage, 5 + expected.byteLength).fill(0xcc)
    const view = new DataView(storage)

    TestStruct.packListInto(values, view, 5)

    expect([...new Uint8Array(storage, 5, expected.byteLength)]).toEqual([...new Uint8Array(expected)])
    expect([...new Uint8Array(storage, 0, 5)]).toEqual(Array(5).fill(0xcc))
    expect([...new Uint8Array(storage, 5 + expected.byteLength)]).toEqual(Array(5).fill(0xcc))
  })

  test("packListInto rejects fields with retained pointer targets", () => {
    const StringStruct = defineStruct([
      ["text", "char*"],
      ["length", "u32", { lengthOf: "text" }],
    ] as const)
    const buffer = new ArrayBuffer(StringStruct.size)

    expect(() => (StringStruct as any).packListInto([{ text: "hello" }], new DataView(buffer), 0)).toThrow(
      "packListInto only supports required primitive fields",
    )
    expect([...new Uint8Array(buffer)]).toEqual(Array(StringStruct.size).fill(0))
  })

  test("reducer-aware list specialization preserves callback semantics", () => {
    const options = {
      calls: 0,
      reduceValue(this: { calls: number }, value: { value: number; reserved: number }) {
        this.calls += 1
        return { value: value.value }
      },
    }
    const TestStruct = defineStruct(
      [
        ["value", "u32"],
        ["reserved", "u32", { default: 0 }],
      ] as const,
      options,
    )
    const values = Array.from({ length: 256 }, (_, value) => ({ value }))
    const buffer = TestStruct.packList(values)

    expect(TestStruct.unpackList(buffer, values.length)).toEqual(values)
    expect(options.calls).toBe(values.length)
  })
})
