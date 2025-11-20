import { beforeAll, describe, expect, it } from "bun:test"
import { dlopen, ptr, toArrayBuffer } from "bun:ffi"
import { execSync } from "child_process"
import { existsSync } from "fs"
import { join } from "path"
import { defineStruct } from "../structs_ffi"

const testDir = __dirname
const libPath = join(testDir, "libtest.dylib")

let native: any

beforeAll(() => {
  console.log(`Building native library at ${libPath}...`)
  const zigFile = join(testDir, "test.zig")

  if (!existsSync(zigFile)) {
    throw new Error(`test.zig not found at ${zigFile}`)
  }

  execSync(`zig build-lib ${zigFile} -dynamic -femit-bin=${libPath}`, {
    cwd: testDir,
    stdio: "inherit",
  })

  if (!existsSync(libPath)) {
    throw new Error(`Failed to build native library at ${libPath}`)
  }

  console.log(`Native library built successfully`)

  native = dlopen(libPath, {
    createTestPerson: {
      args: [],
      returns: "ptr",
    },
    validatePerson: {
      args: ["ptr", "u32", "f32", "f64"],
      returns: "bool",
    },
  })
})

describe("Native Zig interop", () => {
  const SimplePerson = defineStruct([
    ["age", "u32"],
    ["height", "f32"],
    ["weight", "f64"],
  ])

  describe("TypeScript → Zig (pack then validate by Zig)", () => {
    it("should pack data correctly for Zig", () => {
      const testData = {
        age: 30,
        height: 175.5,
        weight: 70.2,
      }

      const buffer = SimplePerson.pack(testData)
      expect(buffer.byteLength).toBe(SimplePerson.size)

      const isValid = native.symbols.validatePerson(ptr(buffer), 30, 175.5, 70.2)
      expect(isValid).toBe(true)
    })
  })

  describe("Zig → TypeScript (unpack Zig-created structs)", () => {
    it("should unpack Zig struct", () => {
      const zigPersonPtr = native.symbols.createTestPerson()
      expect(zigPersonPtr).not.toBe(0n)

      const zigBuffer = toArrayBuffer(zigPersonPtr as any, 0, SimplePerson.size)
      const unpacked = SimplePerson.unpack(zigBuffer)

      expect(unpacked.age).toBe(30)
      expect(unpacked.height).toBeCloseTo(175.5, 1)
      expect(unpacked.weight).toBeCloseTo(70.2, 1)
    })
  })

  describe("Round-trip: TypeScript → Zig → TypeScript", () => {
    it("should preserve data through pack → Zig validation → unpack", () => {
      const originalData = {
        age: 33,
        height: 182.3,
        weight: 78.5,
      }

      const packed = SimplePerson.pack(originalData)

      const isValid = native.symbols.validatePerson(ptr(packed), 33, 182.3, 78.5)
      expect(isValid).toBe(true)

      const unpacked = SimplePerson.unpack(packed)
      expect(unpacked.age).toBe(33)
      expect(unpacked.height).toBeCloseTo(182.3, 1)
      expect(unpacked.weight).toBeCloseTo(78.5, 1)
    })
  })
})
