import { defineStruct } from "../src/structs_ffi"

console.log("=== Example 16: cstring vs char* ===\n")

const CStringStruct = defineStruct([
  ["id", "u32"],
  ["name", "cstring"],
] as const)

const CharStarStruct = defineStruct([
  ["id", "u32"],
  ["nameLength", "u32", { lengthOf: "nameData" }],
  ["nameData", "char*"],
] as const)

console.log("1. cstring (null-terminated):")
const cstringData = {
  id: 1,
  name: "hello",
}

const cstringPacked = CStringStruct.pack(cstringData)
console.log("  Input:", cstringData)
console.log("  Packed size:", cstringPacked.byteLength, "bytes")
console.log("  Automatically adds null terminator")
console.log("  Note: cstring unpacking not yet implemented (returns pointer)")

console.log("\n2. char* with lengthOf (automatic unpacking):")
const charStarData = {
  id: 2,
  nameData: "world 🌍",
}

const charStarPacked = CharStarStruct.pack(charStarData)
console.log("  Input:", charStarData)
console.log("  Packed size:", charStarPacked.byteLength, "bytes")
console.log("  Length stored in nameLength field:", Buffer.byteLength("world 🌍"), "bytes")

const charStarUnpacked = CharStarStruct.unpack(charStarPacked)
console.log("\n  Unpacked:")
console.log("    id:", charStarUnpacked.id)
console.log("    nameData:", charStarUnpacked.nameData)
console.log("    nameLength:", charStarUnpacked.nameLength)
console.log("  ✓ char* with lengthOf automatically unpacks to string!")

console.log("\n3. char* without lengthOf (returns pointer):")
const PointerStruct = defineStruct([
  ["id", "u32"],
  ["data", "char*"],
] as const)

const pointerData = {
  id: 3,
  data: "test",
}

const pointerPacked = PointerStruct.pack(pointerData)
const pointerUnpacked = PointerStruct.unpack(pointerPacked)
console.log("  Input:", pointerData)
console.log("  Unpacked data (pointer):", pointerUnpacked.data)
console.log("  Type:", typeof pointerUnpacked.data)
console.log("  Note: Without lengthOf, char* returns the raw pointer value")

console.log("\n4. Unicode and emoji support:")
const UnicodeStruct = defineStruct([
  ["text", "char*"],
  ["textLength", "u32", { lengthOf: "text" }],
] as const)

const testStrings = ["Hello", "Café", "Hello 🌍🎉✨", "👨‍👩‍👧‍👦", "日本語"]

console.log("  Testing various unicode strings:")
for (const str of testStrings) {
  const packed = UnicodeStruct.pack({ text: str })
  const unpacked = UnicodeStruct.unpack(packed)
  const match = unpacked.text === str
  console.log(`    "${str}" -> ${match ? "✓" : "✗"} (${unpacked.textLength} bytes)`)
}
