import { beforeAll, describe, expect, it } from "bun:test"
import { dlopen, ptr, toArrayBuffer } from "bun:ffi"
import { execSync } from "child_process"
import { existsSync } from "fs"
import { join } from "path"
import { defineStruct } from "../structs_ffi.js"

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
    createHighlightList: {
      args: [],
      returns: "ptr",
    },
    validateHighlight: {
      args: ["ptr", "u32", "u32", "u32", "u8", "u16", "ptr", "usize"],
      returns: "bool",
    },
    validateHighlightList: {
      args: ["ptr", "usize"],
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

describe("Native Zig interop with char* and lengthOf", () => {
  const HighlightStruct = defineStruct([
    ["start", "u32"],
    ["end", "u32"],
    ["styleId", "u32"],
    ["priority", "u8", { default: 0 }],
    ["hlRef", "u16", { default: 0 }],
    ["concealText", "char*", { optional: true }],
    ["concealTextLen", "u64", { lengthOf: "concealText" }],
  ])

  describe("Single struct packing", () => {
    it("should pack a single highlight correctly for Zig", () => {
      const highlight = {
        start: 6,
        end: 11,
        styleId: 1,
        priority: 0,
        hlRef: 0,
        concealText: "XXX",
      }

      const buffer = HighlightStruct.pack(highlight)
      expect(buffer.byteLength).toBe(HighlightStruct.size)

      // Validate with Zig
      const isValid = native.symbols.validateHighlight(ptr(buffer), 6, 11, 1, 0, 0, ptr(Buffer.from("XXX")), 3)
      expect(isValid).toBe(true)
    })

    it("should pack highlight with emoji correctly", () => {
      const highlight = {
        start: 30,
        end: 35,
        styleId: 3,
        priority: 1,
        hlRef: 20,
        concealText: "Hello🌍",
      }

      const buffer = HighlightStruct.pack(highlight)
      const encodedText = Buffer.from("Hello🌍")

      const isValid = native.symbols.validateHighlight(
        ptr(buffer),
        30,
        35,
        3,
        1,
        20,
        ptr(encodedText),
        encodedText.length,
      )
      expect(isValid).toBe(true)
    })

    it("should pack highlight with null text", () => {
      const highlight = {
        start: 1,
        end: 5,
        styleId: 1,
        priority: 0,
        hlRef: 0,
        concealText: null,
      }

      const buffer = HighlightStruct.pack(highlight)

      const isValid = native.symbols.validateHighlight(ptr(buffer), 1, 5, 1, 0, 0, null, 0)
      expect(isValid).toBe(true)
    })
  })

  describe("List packing (TypeScript → Zig)", () => {
    it("should pack a list of highlights for Zig to consume", () => {
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
          concealText: "Hello🌍",
        },
      ]

      const buffer = HighlightStruct.packList(highlights)
      expect(buffer.byteLength).toBe(HighlightStruct.size * 3)

      // Validate entire list with Zig
      const isValid = native.symbols.validateHighlightList(ptr(buffer), 3)
      expect(isValid).toBe(true)
    })

    it("should pack list with mixed null and non-null text", () => {
      const highlights = [
        {
          start: 1,
          end: 5,
          styleId: 1,
          priority: 0,
          hlRef: 0,
          concealText: null,
        },
        {
          start: 10,
          end: 15,
          styleId: 2,
          priority: 1,
          hlRef: 5,
          concealText: "Test",
        },
        {
          start: 20,
          end: 25,
          styleId: 3,
          priority: 2,
          hlRef: 10,
          concealText: null,
        },
      ]

      const buffer = HighlightStruct.packList(highlights)
      expect(buffer.byteLength).toBe(HighlightStruct.size * 3)

      // Validate each struct individually
      const testBuffer = Buffer.from("Test")
      const h1Valid = native.symbols.validateHighlight(ptr(buffer), 1, 5, 1, 0, 0, null, 0)
      expect(h1Valid).toBe(true)

      const offsetH2 = HighlightStruct.size
      const h2Buffer = buffer.slice(offsetH2, offsetH2 + HighlightStruct.size)
      const h2Valid = native.symbols.validateHighlight(ptr(h2Buffer), 10, 15, 2, 1, 5, ptr(testBuffer), 4)
      expect(h2Valid).toBe(true)

      const offsetH3 = HighlightStruct.size * 2
      const h3Buffer = buffer.slice(offsetH3, offsetH3 + HighlightStruct.size)
      const h3Valid = native.symbols.validateHighlight(ptr(h3Buffer), 20, 25, 3, 2, 10, null, 0)
      expect(h3Valid).toBe(true)
    })
  })

  describe("List unpacking (Zig → TypeScript)", () => {
    it("should unpack a Zig-created list of highlights", () => {
      const zigListPtr = native.symbols.createHighlightList()
      expect(zigListPtr).not.toBe(0n)

      const count = 3
      const byteLen = count * HighlightStruct.size
      const raw = toArrayBuffer(zigListPtr as any, 0, byteLen)
      const highlights = HighlightStruct.unpackList(raw, count)

      expect(highlights).toHaveLength(3)

      // Validate first highlight
      expect(highlights[0]!.start).toBe(6)
      expect(highlights[0]!.end).toBe(11)
      expect(highlights[0]!.styleId).toBe(1)
      expect(highlights[0]!.priority).toBe(0)
      expect(highlights[0]!.hlRef).toBe(0)
      expect(highlights[0]!.concealText).toBe("XXX")
      expect(highlights[0]!.concealTextLen).toBe(3n)

      // Validate second highlight
      expect(highlights[1]!.start).toBe(18)
      expect(highlights[1]!.end).toBe(24)
      expect(highlights[1]!.styleId).toBe(2)
      expect(highlights[1]!.priority).toBe(5)
      expect(highlights[1]!.hlRef).toBe(10)
      expect(highlights[1]!.concealText).toBe("******")
      expect(highlights[1]!.concealTextLen).toBe(6n)

      // Validate third highlight (with emoji)
      expect(highlights[2]!.start).toBe(30)
      expect(highlights[2]!.end).toBe(35)
      expect(highlights[2]!.styleId).toBe(3)
      expect(highlights[2]!.priority).toBe(1)
      expect(highlights[2]!.hlRef).toBe(20)
      expect(highlights[2]!.concealText).toBe("Hello🌍")
      // Emoji takes more bytes in UTF-8
      expect(highlights[2]!.concealTextLen).toBeGreaterThan(5n)
    })
  })

  describe("Full roundtrip: TypeScript → packList → unpackList → TypeScript", () => {
    it("should preserve all data through packList/unpackList cycle", () => {
      const original = [
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
          concealText: "Hello🌍",
        },
      ]

      const packed = HighlightStruct.packList(original)
      const unpacked = HighlightStruct.unpackList(packed, original.length)

      expect(unpacked).toHaveLength(original.length)

      for (let i = 0; i < original.length; i++) {
        expect(unpacked[i]!.start).toBe(original[i]!.start)
        expect(unpacked[i]!.end).toBe(original[i]!.end)
        expect(unpacked[i]!.styleId).toBe(original[i]!.styleId)
        expect(unpacked[i]!.priority).toBe(original[i]!.priority)
        expect(unpacked[i]!.hlRef).toBe(original[i]!.hlRef)
        expect(unpacked[i]!.concealText).toBe(original[i]!.concealText)
      }
    })

    it("should handle empty list roundtrip", () => {
      const original: any[] = []

      const packed = HighlightStruct.packList(original)
      const unpacked = HighlightStruct.unpackList(packed, 0)

      expect(unpacked).toHaveLength(0)
      expect(packed.byteLength).toBe(0)
    })

    it("should handle single item roundtrip", () => {
      const original = [
        {
          start: 1,
          end: 5,
          styleId: 99,
          priority: 7,
          hlRef: 42,
          concealText: "Solo",
        },
      ]

      const packed = HighlightStruct.packList(original)
      const unpacked = HighlightStruct.unpackList(packed, 1)

      expect(unpacked).toHaveLength(1)
      expect(unpacked[0]!.start).toBe(1)
      expect(unpacked[0]!.end).toBe(5)
      expect(unpacked[0]!.styleId).toBe(99)
      expect(unpacked[0]!.priority).toBe(7)
      expect(unpacked[0]!.hlRef).toBe(42)
      expect(unpacked[0]!.concealText).toBe("Solo")
    })

    it("should handle complex unicode in roundtrip", () => {
      const original = [
        {
          start: 1,
          end: 10,
          styleId: 1,
          concealText: "👨‍👩‍👧‍👦",
        },
        {
          start: 11,
          end: 20,
          styleId: 2,
          concealText: "🏳️‍🌈",
        },
        {
          start: 21,
          end: 30,
          styleId: 3,
          concealText: "Hello Café 日本語 🌍 Привет",
        },
      ]

      const packed = HighlightStruct.packList(original)
      const unpacked = HighlightStruct.unpackList(packed, original.length)

      expect(unpacked).toHaveLength(original.length)
      for (let i = 0; i < original.length; i++) {
        expect(unpacked[i]!.concealText).toBe(original[i]!.concealText)
      }
    })

    it("should handle null concealText in roundtrip", () => {
      const original = [
        {
          start: 1,
          end: 5,
          styleId: 1,
          concealText: null,
        },
        {
          start: 10,
          end: 15,
          styleId: 2,
          concealText: "Text",
        },
        {
          start: 20,
          end: 25,
          styleId: 3,
          concealText: null,
        },
      ]

      const packed = HighlightStruct.packList(original)
      const unpacked = HighlightStruct.unpackList(packed, original.length)

      expect(unpacked).toHaveLength(original.length)
      expect(unpacked[0]!.concealText).toBeNull()
      expect(unpacked[0]!.concealTextLen).toBe(0n)
      expect(unpacked[1]!.concealText).toBe("Text")
      expect(unpacked[2]!.concealText).toBeNull()
      expect(unpacked[2]!.concealTextLen).toBe(0n)
    })

    it("should handle empty string in roundtrip", () => {
      const original = [
        {
          start: 1,
          end: 5,
          styleId: 1,
          concealText: "",
        },
      ]

      const packed = HighlightStruct.packList(original)
      const unpacked = HighlightStruct.unpackList(packed, 1)

      expect(unpacked).toHaveLength(1)
      // Empty strings are treated as null
      expect(unpacked[0]!.concealText).toBeNull()
      expect(unpacked[0]!.concealTextLen).toBe(0n)
    })

    it("should handle large list roundtrip", () => {
      const original = Array.from({ length: 100 }, (_, i) => ({
        start: i * 10,
        end: i * 10 + 5,
        styleId: i % 10,
        priority: (i % 5) as any,
        hlRef: (i % 20) as any,
        concealText: i % 3 === 0 ? null : `Text${i}`,
      }))

      const packed = HighlightStruct.packList(original)
      const unpacked = HighlightStruct.unpackList(packed, original.length)

      expect(unpacked).toHaveLength(original.length)
      for (let i = 0; i < original.length; i++) {
        expect(unpacked[i]!.start).toBe(original[i]!.start)
        expect(unpacked[i]!.end).toBe(original[i]!.end)
        expect(unpacked[i]!.styleId).toBe(original[i]!.styleId)
        expect(unpacked[i]!.concealText).toBe(original[i]!.concealText)
      }
    })
  })

  describe("Full roundtrip through Zig validation", () => {
    it("should pack → validate with Zig → unpack correctly", () => {
      const original = [
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
          concealText: "Hello🌍",
        },
      ]

      // Pack in TypeScript
      const packed = HighlightStruct.packList(original)

      // Validate with Zig
      const isValid = native.symbols.validateHighlightList(ptr(packed), 3)
      expect(isValid).toBe(true)

      // Unpack in TypeScript
      const unpacked = HighlightStruct.unpackList(packed, original.length)

      // Verify unpacked matches original
      expect(unpacked).toHaveLength(original.length)
      for (let i = 0; i < original.length; i++) {
        expect(unpacked[i]!.start).toBe(original[i]!.start)
        expect(unpacked[i]!.end).toBe(original[i]!.end)
        expect(unpacked[i]!.styleId).toBe(original[i]!.styleId)
        expect(unpacked[i]!.priority).toBe(original[i]!.priority)
        expect(unpacked[i]!.hlRef).toBe(original[i]!.hlRef)
        expect(unpacked[i]!.concealText).toBe(original[i]!.concealText)
      }
    })
  })
})
