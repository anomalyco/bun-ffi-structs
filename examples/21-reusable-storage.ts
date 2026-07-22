import { defineStruct } from "../src/structs_ffi.js"

console.log("=== Example 21: Reusable Pack and Unpack Storage ===\n")

const CursorStruct = defineStruct([
  ["row", "u32"],
  ["col", "u32"],
  ["offset", "u32"],
] as const)

const cursors = [
  { row: 1, col: 2, offset: 3 },
  { row: 4, col: 5, offset: 6 },
  { row: 7, col: 8, offset: 9 },
]
const buffer = new ArrayBuffer(CursorStruct.size * cursors.length)
const view = new DataView(buffer)

CursorStruct.packListInto(cursors, view, 0)

const cursor: Record<string, unknown> = {}
for (let index = 0; index < cursors.length; index += 1) {
  CursorStruct.unpackInto(view, cursor, index * CursorStruct.size)
  console.log(`Cursor ${index + 1}:`, { ...cursor })
}

if (cursor.row !== 7 || cursor.col !== 8 || cursor.offset !== 9) {
  throw new Error("Reusable cursor roundtrip failed")
}

console.log("\nReusable storage avoids allocating a packet or result object for each operation.")
