import { expect, test } from "bun:test"
import { defineStruct } from "../structs_ffi.js"

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
