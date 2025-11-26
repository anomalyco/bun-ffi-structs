import { defineStruct } from "../src/structs_ffi"

console.log("=== Example 20: List Unpacking with char* and lengthOf ===\n")

// Define a struct that uses a char* (pointer to string) and a length field that refers to it
// This pattern is common in C/Zig APIs where a string is passed as a pointer + length
const HighlightStruct = defineStruct([
  ["start", "u32"],
  ["end", "u32"],
  ["styleId", "u32"],
  ["priority", "u8", { default: 0 }],
  ["hlRef", "u16", { default: 0 }],
  // char* is a pointer to a string.
  // When packing, it writes the string to a buffer and stores the pointer.
  // When unpacking, it reads the string from the pointer.
  ["concealText", "char*", { optional: true }],
  // lengthOf tells the unpacker where to find the length of the string
  // This is crucial for correctly reading the string back from memory
  ["concealTextLen", "u64", { lengthOf: "concealText" }],
] as const)

console.log("1. Defining HighlightStruct with char* and lengthOf...")

const highlights = [
  {
    start: 6,
    end: 11,
    styleId: 1,
    priority: 0,
    hlRef: 0,
    concealText: "XXX",
  },
  {
    start: 18,
    end: 24,
    styleId: 2,
    priority: 5,
    hlRef: 10,
    concealText: "******",
  },
  {
    start: 30,
    end: 35,
    styleId: 3,
    priority: 1,
    hlRef: 20,
    concealText: "Hello🌍", // Emoji support (UTF-8)
  },
  {
    start: 40,
    end: 45,
    styleId: 4,
    priority: 2,
    hlRef: 30,
    concealText: null, // Optional field support
  },
]

console.log(`\n2. Packing ${highlights.length} highlight objects into a buffer...`)
// packList creates a single buffer containing all the structs packed contiguously
const buffer = HighlightStruct.packList(highlights)

console.log(`✓ Packed into ${buffer.byteLength} bytes`)
console.log(`  Struct size: ${HighlightStruct.size} bytes`)
console.log(`  Total expected size: ${HighlightStruct.size * highlights.length} bytes`)

console.log("\n3. Unpacking the buffer back into objects...")
// unpackList reads the buffer and reconstructs the objects
// This demonstrates the fix where relative offsets for lengthOf are handled correctly during iteration
const unpacked = HighlightStruct.unpackList(buffer, highlights.length)

console.log(`✓ Unpacked ${unpacked.length} objects`)

console.log("\n4. Verifying data integrity...")

unpacked.forEach((item, i) => {
  const original = highlights[i]
  if (!original) throw new Error(`Missing original item at index ${i}`)

  console.log(`  Item ${i}:`)
  console.log(`    Original: start=${original.start}, text=${original.concealText}`)
  console.log(`    Unpacked: start=${item!.start}, text=${item!.concealText}`)

  if (item!.start !== original.start || item!.concealText !== original.concealText) {
    console.error(`    ❌ Mismatch at index ${i}!`)
    process.exit(1)
  }
})

console.log("\n✓ All items matched correctly!")
console.log("\nThis example demonstrates that `unpackList` can correctly handle `char*` fields")
console.log("that rely on a `lengthOf` field, even when iterating through an array of structs.")
console.log("Previously, the offset calculation for `lengthOf` might have been incorrect during list iteration.")
