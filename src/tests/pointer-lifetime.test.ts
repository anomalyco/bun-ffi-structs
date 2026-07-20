import { expect, test } from "bun:test"
import { allocStruct, defineStruct, pointerSize } from "../structs_ffi.js"
import { ptr, toArrayBuffer } from "../ffi.js"

async function forceGc() {
  Bun.gc(true)
  globalThis.gc?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test("packed pointer targets are kept alive", async () => {
  const StringStruct = defineStruct([
    ["data", "char*"],
    ["length", "u32", { lengthOf: "data" }],
  ] as const)

  const expected = "A".repeat(1024)
  const packed = StringStruct.pack({ data: expected })

  for (let i = 0; i < 100; i++) {
    await forceGc()
  }

  for (let round = 0; round < 100; round++) {
    const trash = []
    for (let i = 0; i < 1000; i++) {
      trash.push(new Uint8Array(expected.length).fill(round % 256))
    }

    await forceGc()
    const unpacked = StringStruct.unpack(packed)

    expect(unpacked.data).toBe(expected)
  }
})

const ColorStruct = defineStruct([
  ["id", "u32"],
  ["color", "pointer", { optional: true }],
] as const)

function readColor(address: number | bigint): number[] {
  return [...new Uint16Array(toArrayBuffer(address, 0, 8).slice(0))]
}

function readPointer(buffer: ArrayBuffer, offset: number): number | bigint {
  const view = new DataView(buffer)
  return pointerSize === 8 ? view.getBigUint64(offset, true) : view.getUint32(offset, true)
}

test("pointer fields accept buffer values and retain them with the packed struct", async () => {
  const packFreshColor = (id: number) => {
    // The view is unreachable after this function returns; only the packed
    // struct may keep it alive.
    const color = new Uint16Array([id, id + 1, id + 2, id + 3])
    return { packed: ColorStruct.pack({ id, color }), expected: [...color] }
  }

  const { packed, expected } = packFreshColor(7)

  for (let round = 0; round < 100; round++) {
    const trash = []
    for (let i = 0; i < 1000; i++) {
      trash.push(new Uint16Array(4).fill(round % 65536))
    }

    await forceGc()

    const unpacked = ColorStruct.unpack(packed)
    expect(readColor(unpacked.color!)).toEqual(expected)
  }
})

test("packList retains buffer-valued pointer fields for every element", async () => {
  const packFreshColors = (count: number) => {
    const items = []
    const expected = []
    for (let i = 0; i < count; i++) {
      const color = new Uint16Array([i, i * 2, i * 3, 65535 - i])
      items.push({ id: i, color })
      expected.push([...color])
    }
    return { packed: ColorStruct.packList(items), expected }
  }

  const count = 32
  const { packed, expected } = packFreshColors(count)

  for (let round = 0; round < 20; round++) {
    const trash = []
    for (let i = 0; i < 1000; i++) {
      trash.push(new Uint16Array(4).fill(round % 65536))
    }

    await forceGc()

    const unpacked = ColorStruct.unpackList(packed, count)
    for (let i = 0; i < count; i++) {
      expect(readColor(unpacked[i]!.color!)).toEqual(expected[i]!)
    }
  }
})

test("packTransform results that are buffers are retained like direct buffer values", async () => {
  const TransformStruct = defineStruct([
    [
      "color",
      "pointer",
      {
        optional: true,
        packTransform: (rgb?: { values: Uint16Array }) => rgb?.values ?? null,
      },
    ],
  ] as const)

  const packFresh = () => {
    const rgb = { values: new Uint16Array([1, 2, 3, 4]) }
    return { packed: TransformStruct.pack({ color: rgb }), expected: [...rgb.values] }
  }

  const { packed, expected } = packFresh()

  for (let round = 0; round < 100; round++) {
    const trash = []
    for (let i = 0; i < 1000; i++) {
      trash.push(new Uint16Array(4).fill(round % 65536))
    }

    await forceGc()

    const unpacked = TransformStruct.unpack(packed)
    expect(readColor(unpacked.color!)).toEqual(expected)
  }
})

test("empty buffers pack as null pointers", () => {
  const emptyBuffer = ColorStruct.unpack(ColorStruct.pack({ id: 1, color: new ArrayBuffer(0) }))
  expect(emptyBuffer.color === 0 || emptyBuffer.color === 0n).toBe(true)

  const emptyView = ColorStruct.unpack(ColorStruct.pack({ id: 2, color: new Uint8Array(0) }))
  expect(emptyView.color === 0 || emptyView.color === 0n).toBe(true)
})

test("raw addresses still pack unchanged and views keep their byte offsets", () => {
  const rooted = new Uint16Array([9, 9, 9, 9])
  const rawAddress = ptr(rooted)
  const rawUnpacked = ColorStruct.unpack(ColorStruct.pack({ id: 3, color: rawAddress }))
  expect(BigInt(rawUnpacked.color!)).toBe(BigInt(rawAddress))
  expect(readColor(rawUnpacked.color!)).toEqual([9, 9, 9, 9])

  const backing = new Uint16Array(8)
  backing.set([5, 6, 7, 8], 4)
  const offsetView = new Uint16Array(backing.buffer, 8, 4)
  const offsetUnpacked = ColorStruct.unpack(ColorStruct.pack({ id: 4, color: offsetView }))
  expect(BigInt(offsetUnpacked.color!)).toBe(BigInt(ptr(offsetView)))
  expect(readColor(offsetUnpacked.color!)).toEqual([5, 6, 7, 8])
})

test("cstrings, nested pointers, struct arrays, and allocStruct buffers are retained", async () => {
  const CStringStruct = defineStruct([["value", "cstring"]] as const)
  const ChildStruct = defineStruct([["value", "u32"]] as const)
  const NestedPointerStruct = defineStruct([["child", ChildStruct, { asPointer: true }]] as const)
  const StructArray = defineStruct([
    ["count", "u32", { lengthOf: "items" }],
    ["items", [ChildStruct]],
  ] as const)
  const AllocatedArray = defineStruct([
    ["count", "u32", { lengthOf: "items" }],
    ["items", ["u32"]],
  ] as const)

  const createOwners = () => {
    const cstring = CStringStruct.pack({ value: "retained" })
    const nested = NestedPointerStruct.pack({ child: { value: 123 } })
    const structs = StructArray.pack({ items: [{ value: 456 }] })
    const allocated = allocStruct(AllocatedArray, { lengths: { items: 1 } })
    new DataView(allocated.subBuffers!.items!).setUint32(0, 789, true)
    return { cstring, nested, structs, allocated: allocated.buffer }
  }

  const owners = createOwners()
  for (let round = 0; round < 25; round++) {
    const trash = []
    for (let i = 0; i < 1000; i++) {
      trash.push(new Uint8Array(4).fill(round), new Uint8Array(9).fill(round))
    }
    await forceGc()
  }

  const cstringPointer = readPointer(owners.cstring, 0)
  expect(new TextDecoder().decode(toArrayBuffer(cstringPointer, 0, 8))).toBe("retained")

  const nestedPointer = readPointer(owners.nested, 0)
  expect(new DataView(toArrayBuffer(nestedPointer, 0, ChildStruct.size)).getUint32(0, true)).toBe(123)

  const structsOffset = StructArray.layoutByName.get("items")!.offset
  const structsPointer = readPointer(owners.structs, structsOffset)
  expect(new DataView(toArrayBuffer(structsPointer, 0, ChildStruct.size)).getUint32(0, true)).toBe(456)

  const allocatedOffset = AllocatedArray.layoutByName.get("items")!.offset
  const allocatedPointer = readPointer(owners.allocated, allocatedOffset)
  expect(new DataView(toArrayBuffer(allocatedPointer, 0, 4)).getUint32(0, true)).toBe(789)
})
