import { PersonStruct, getAge, getHeight, getWeight, getName, calculateBMI } from "./lib.js"

console.log("=== Native FFI with Struct Packing ===\n")

const personData = {
  age: 30,
  height: 175.5,
  weight: 70.2,
  name: "Alice",
}

console.log("Original person data:", personData)

console.log("\nPacking person into ArrayBuffer...")
const personBuffer = PersonStruct.pack(personData)
console.log("Packed buffer size:", personBuffer.byteLength, "bytes")

console.log("\nReading data back from native functions:")
console.log("Age:", getAge(personBuffer))
console.log("Height:", getHeight(personBuffer), "cm")
console.log("Weight:", getWeight(personBuffer), "kg")
console.log("Name:", getName(personBuffer))
console.log("BMI:", calculateBMI(personBuffer).toFixed(2))

console.log("\n✓ Successfully packed struct and passed to native Zig code!")
