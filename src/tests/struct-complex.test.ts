import { expect, describe, it } from "bun:test"
import { toArrayBuffer } from "../ffi.js"
import { defineEnum, defineStruct } from "../structs_ffi.js"

describe("complex struct with length field and nested arrays", () => {
  it("should handle bind group layout-like structure", () => {
    const BufferLayoutStruct = defineStruct([
      ["type", "u32", { default: 2 }], // uniform = 2
      ["hasDynamicOffset", "bool_u32", { default: false }],
      ["minBindingSize", "u64", { default: 0 }],
    ] as const)

    const SamplerLayoutStruct = defineStruct([
      ["type", "u32", { default: 2 }], // filtering = 2
    ] as const)

    const TextureLayoutStruct = defineStruct([
      ["sampleType", "u32", { default: 2 }], // float = 2
      ["viewDimension", "u32", { default: 2 }], // 2d = 2
      ["multisampled", "bool_u32", { default: false }],
    ] as const)

    const BindGroupLayoutEntryStruct = defineStruct([
      ["binding", "u32"],
      ["visibility", "u64"],
      ["buffer", BufferLayoutStruct, { optional: true }],
      ["sampler", SamplerLayoutStruct, { optional: true }],
      ["texture", TextureLayoutStruct, { optional: true }],
    ] as const)

    const BindGroupLayoutDescriptorStruct = defineStruct([
      ["label", "cstring", { optional: true }],
      ["entryCount", "u64", { lengthOf: "entries" }],
      ["entries", [BindGroupLayoutEntryStruct]],
    ] as const)

    const input = {
      label: "test-layout",
      entries: [
        {
          binding: 0,
          visibility: 0x4n, // FRAGMENT = 4
          buffer: {
            type: 2, // uniform
            hasDynamicOffset: false,
            minBindingSize: 0,
          },
        },
        {
          binding: 1,
          visibility: 0x4n, // FRAGMENT = 4
          sampler: {
            type: 2, // filtering
          },
        },
        {
          binding: 2,
          visibility: 0x4n, // FRAGMENT = 4
          texture: {
            sampleType: 2, // float
            viewDimension: 2, // 2d
            multisampled: false,
          },
        },
      ],
    }

    const packed = BindGroupLayoutDescriptorStruct.pack(input)

    // Verify basic buffer properties
    expect(packed.byteLength).toBeGreaterThan(0)
    expect(packed.byteLength).toBe(BindGroupLayoutDescriptorStruct.size)

    // Verify the length field was set correctly by reading it directly
    const view = new DataView(packed)
    const entryCount = view.getBigUint64(8, true) // entryCount is at offset 8 (after label pointer)
    expect(entryCount).toBe(3n)

    // Verify entries pointer is not null (should point to allocated array)
    const entriesPtr = view.getBigUint64(16, true) // entries pointer at offset 16
    expect(entriesPtr).not.toBe(0n)

    // Now verify the actual packed entries data
    const entryStructSize = BindGroupLayoutEntryStruct.size
    const totalEntriesSize = entryStructSize * 3

    // Get the field layout to understand offsets
    const entryLayout = BindGroupLayoutEntryStruct.describe()

    // Read the entries array buffer
    const entriesBuffer = toArrayBuffer(entriesPtr, 0, totalEntriesSize)
    const entriesView = new DataView(entriesBuffer)

    // Get field offsets from the struct layout
    const bindingOffset = entryLayout.find((f) => f.name === "binding")?.offset ?? 0
    const visibilityOffset = entryLayout.find((f) => f.name === "visibility")?.offset ?? 0
    const bufferOffset = entryLayout.find((f) => f.name === "buffer")?.offset ?? 0
    const samplerOffset = entryLayout.find((f) => f.name === "sampler")?.offset ?? 0
    const textureOffset = entryLayout.find((f) => f.name === "texture")?.offset ?? 0

    // Verify first entry (buffer binding)
    let entryBaseOffset = 0
    expect(entriesView.getUint32(entryBaseOffset + bindingOffset, true)).toBe(0) // binding = 0
    expect(entriesView.getBigUint64(entryBaseOffset + visibilityOffset, true)).toBe(0x4n) // visibility = FRAGMENT

    // Check buffer sub-struct fields (type, hasDynamicOffset, minBindingSize)
    expect(entriesView.getUint32(entryBaseOffset + bufferOffset, true)).toBe(2) // buffer.type = uniform
    expect(entriesView.getUint32(entryBaseOffset + bufferOffset + 4, true)).toBe(0) // buffer.hasDynamicOffset = false
    expect(entriesView.getBigUint64(entryBaseOffset + bufferOffset + 8, true)).toBe(0n) // buffer.minBindingSize = 0

    // Verify second entry (sampler binding)
    entryBaseOffset = entryStructSize
    expect(entriesView.getUint32(entryBaseOffset + bindingOffset, true)).toBe(1) // binding = 1
    expect(entriesView.getBigUint64(entryBaseOffset + visibilityOffset, true)).toBe(0x4n) // visibility = FRAGMENT

    // Check sampler sub-struct field (type)
    expect(entriesView.getUint32(entryBaseOffset + samplerOffset, true)).toBe(2) // sampler.type = filtering

    // Verify third entry (texture binding)
    entryBaseOffset = entryStructSize * 2
    expect(entriesView.getUint32(entryBaseOffset + bindingOffset, true)).toBe(2) // binding = 2
    expect(entriesView.getBigUint64(entryBaseOffset + visibilityOffset, true)).toBe(0x4n) // visibility = FRAGMENT

    // Check texture sub-struct fields (sampleType, viewDimension, multisampled)
    expect(entriesView.getUint32(entryBaseOffset + textureOffset, true)).toBe(2) // texture.sampleType = float
    expect(entriesView.getUint32(entryBaseOffset + textureOffset + 4, true)).toBe(2) // texture.viewDimension = 2d
    expect(entriesView.getUint32(entryBaseOffset + textureOffset + 8, true)).toBe(0) // texture.multisampled = false
  })

  it("should handle empty entries array with correct length field", () => {
    const SimpleEntryStruct = defineStruct([["value", "u32"]] as const)

    const ContainerStruct = defineStruct([
      ["count", "u32", { lengthOf: "items" }],
      ["items", [SimpleEntryStruct]],
    ] as const)

    const input = { items: [] }

    const packed = ContainerStruct.pack(input)

    // Verify buffer size
    expect(packed.byteLength).toBe(ContainerStruct.size)

    // Verify count field is 0
    const view = new DataView(packed)
    const count = view.getUint32(0, true)
    expect(count).toBe(0)

    // Verify items pointer is null for empty array
    const itemsPtr = view.getBigUint64(8, true) // items pointer after count (u32 + padding)
    expect(itemsPtr).toBe(0n)
  })

  it("should calculate correct struct sizes for nested layouts", () => {
    const InnerStruct = defineStruct([
      ["a", "u32"],
      ["b", "f32"],
    ] as const)

    const OuterStruct = defineStruct([
      ["count", "u32", { lengthOf: "items" }],
      ["items", [InnerStruct]],
    ] as const)

    // Each InnerStruct: u32(4) + f32(4) = 8 bytes
    expect(InnerStruct.size).toBe(8)
    // OuterStruct: u32(4) + padding(4) + pointer(8) = 16 bytes
    expect(OuterStruct.size).toBe(16)

    const input = {
      items: [
        { a: 1, b: 2.0 },
        { a: 3, b: 4.0 },
      ],
    }
    const packed = OuterStruct.pack(input)

    expect(packed.byteLength).toBe(16)

    const view = new DataView(packed)
    const count = view.getUint32(0, true)
    expect(count).toBe(2) // Should auto-set from items.length
  })

  it("should handle empty sub-structs with default values", () => {
    const BufferLayoutStruct = defineStruct([
      ["type", "u32", { default: 2 }], // uniform = 2
      ["hasDynamicOffset", "bool_u32", { default: false }],
      ["minBindingSize", "u64", { default: 0 }],
    ] as const)

    const SamplerLayoutStruct = defineStruct([
      ["type", "u32", { default: 2 }], // filtering = 2
    ] as const)

    const TextureLayoutStruct = defineStruct([
      ["sampleType", "u32", { default: 2 }], // float = 2
      ["viewDimension", "u32", { default: 2 }], // 2d = 2
      ["multisampled", "bool_u32", { default: false }],
    ] as const)

    const BindGroupLayoutEntryStruct = defineStruct([
      ["binding", "u32"],
      ["visibility", "u64"],
      ["buffer", BufferLayoutStruct, { optional: true }],
      ["sampler", SamplerLayoutStruct, { optional: true }],
      ["texture", TextureLayoutStruct, { optional: true }],
    ] as const)

    const BindGroupLayoutDescriptorStruct = defineStruct([
      ["label", "cstring", { optional: true }],
      ["entryCount", "u64", { lengthOf: "entries" }],
      ["entries", [BindGroupLayoutEntryStruct]],
    ] as const)

    // Test data with EMPTY objects - should get filled with defaults
    const input = {
      label: "test-defaults",
      entries: [
        {
          binding: 0,
          visibility: 0x4n, // FRAGMENT = 4
          buffer: {}, // Empty object - should get defaults
        },
        {
          binding: 1,
          visibility: 0x4n, // FRAGMENT = 4
          sampler: {}, // Empty object - should get defaults
        },
        {
          binding: 2,
          visibility: 0x4n, // FRAGMENT = 4
          texture: {}, // Empty object - should get defaults
        },
      ],
    }

    const packed = BindGroupLayoutDescriptorStruct.pack(input)

    // Verify basic properties
    expect(packed.byteLength).toBe(BindGroupLayoutDescriptorStruct.size)

    const view = new DataView(packed)
    const entryCount = view.getBigUint64(8, true)
    expect(entryCount).toBe(3n)

    const entriesPtr = view.getBigUint64(16, true)
    expect(entriesPtr).not.toBe(0n)

    // Verify the packed entries have default values
    const entryStructSize = BindGroupLayoutEntryStruct.size
    const totalEntriesSize = entryStructSize * 3

    // Get field offsets
    const entryLayout = BindGroupLayoutEntryStruct.describe()
    const bindingOffset = entryLayout.find((f) => f.name === "binding")?.offset ?? 0
    const visibilityOffset = entryLayout.find((f) => f.name === "visibility")?.offset ?? 0
    const bufferOffset = entryLayout.find((f) => f.name === "buffer")?.offset ?? 0
    const samplerOffset = entryLayout.find((f) => f.name === "sampler")?.offset ?? 0
    const textureOffset = entryLayout.find((f) => f.name === "texture")?.offset ?? 0

    // @ts-ignore
    const entriesBuffer = toArrayBuffer(entriesPtr, 0, totalEntriesSize)
    const entriesView = new DataView(entriesBuffer)

    // Verify first entry (buffer with defaults)
    let entryBaseOffset = 0
    expect(entriesView.getUint32(entryBaseOffset + bindingOffset, true)).toBe(0)
    expect(entriesView.getBigUint64(entryBaseOffset + visibilityOffset, true)).toBe(0x4n)

    // Buffer should have DEFAULT values (type=2, hasDynamicOffset=false, minBindingSize=0)
    expect(entriesView.getUint32(entryBaseOffset + bufferOffset, true)).toBe(2) // default type = uniform
    expect(entriesView.getUint32(entryBaseOffset + bufferOffset + 4, true)).toBe(0) // default hasDynamicOffset = false
    expect(entriesView.getBigUint64(entryBaseOffset + bufferOffset + 8, true)).toBe(0n) // default minBindingSize = 0

    // Verify second entry (sampler with defaults)
    entryBaseOffset = entryStructSize
    expect(entriesView.getUint32(entryBaseOffset + bindingOffset, true)).toBe(1)
    expect(entriesView.getBigUint64(entryBaseOffset + visibilityOffset, true)).toBe(0x4n)

    // Sampler should have DEFAULT value (type=2)
    expect(entriesView.getUint32(entryBaseOffset + samplerOffset, true)).toBe(2) // default type = filtering

    // Verify third entry (texture with defaults)
    entryBaseOffset = entryStructSize * 2
    expect(entriesView.getUint32(entryBaseOffset + bindingOffset, true)).toBe(2)
    expect(entriesView.getBigUint64(entryBaseOffset + visibilityOffset, true)).toBe(0x4n)

    // Texture should have DEFAULT values (sampleType=2, viewDimension=2, multisampled=false)
    expect(entriesView.getUint32(entryBaseOffset + textureOffset, true)).toBe(2) // default sampleType = float
    expect(entriesView.getUint32(entryBaseOffset + textureOffset + 4, true)).toBe(2) // default viewDimension = 2d
    expect(entriesView.getUint32(entryBaseOffset + textureOffset + 8, true)).toBe(0) // default multisampled = false
  })

  it("should handle enum defaults in empty sub-structs (reproducing GPUDevice issue)", () => {
    // Create enums exactly like the real ones
    const SampleTypeEnum = defineEnum({
      "binding-not-used": 0,
      undefined: 1,
      float: 2,
      "unfilterable-float": 3,
      depth: 4,
      sint: 5,
      uint: 6,
    })

    const ViewDimensionEnum = defineEnum({
      undefined: 0,
      "1d": 1,
      "2d": 2,
      "2d-array": 3,
      cube: 4,
      "cube-array": 5,
      "3d": 6,
    })

    // Create struct with enum defaults (like WGPUTextureBindingLayoutStruct)
    const TextureLayoutStruct = defineStruct([
      ["nextInChain", "pointer", { optional: true }],
      ["sampleType", SampleTypeEnum, { default: "float" }], // Should become 2
      ["viewDimension", ViewDimensionEnum, { default: "2d" }], // Should become 2
      ["multisampled", "bool_u32", { default: false }],
    ] as const)

    // Create parent struct (like WGPUBindGroupLayoutEntryStruct)
    const EntryStruct = defineStruct([
      ["binding", "u32"],
      ["visibility", "u64"],
      ["texture", TextureLayoutStruct, { optional: true }], // This is the problematic field
    ] as const)

    // Test input with empty texture object (like GPUDevice test)
    const input = {
      binding: 2,
      visibility: 0x4n,
      texture: {}, // Empty object - should get enum defaults applied!
    }

    const packed = EntryStruct.pack(input)

    // Get field offsets
    const layout = EntryStruct.describe()
    const textureOffset = layout.find((f) => f.name === "texture")?.offset ?? 0

    const view = new DataView(packed)

    // Check that enum defaults were applied correctly
    const sampleType = view.getUint32(textureOffset + 8, true) // After nextInChain pointer
    const viewDimension = view.getUint32(textureOffset + 12, true) // After sampleType
    const multisampled = view.getUint32(textureOffset + 16, true) // After viewDimension

    // These should be the enum values, not zeros!
    expect(sampleType).toBe(2) // 'float' enum value
    expect(viewDimension).toBe(2) // '2d' enum value
    expect(multisampled).toBe(0) // false
  })
})
