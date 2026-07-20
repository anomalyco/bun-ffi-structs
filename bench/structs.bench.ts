import { allocStruct, defineEnum, defineStruct, objectPtr, packObjectArray, pointerSize } from "../src/structs_ffi.js"
import { toArrayBuffer } from "../src/ffi.js"
import type { Pointer, StructDef } from "../src/types.js"
import { runBenchmarkSuite, type BenchmarkRuntime, type BenchmarkScenario, type BenchmarkTier } from "./harness.js"

type AnyStruct = StructDef<any, any>

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Benchmark validation failed: ${message}`)
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`Benchmark validation failed: ${message}; expected=${String(expected)} actual=${String(actual)}`)
  }
}

function assertArraySample(actual: Iterable<number>, expected: readonly number[], message: string): void {
  const values = Array.from(actual)
  assertEqual(values.length, expected.length, `${message} length`)
  if (values.length === 0) return
  const indexes = new Set([0, Math.floor(values.length / 2), values.length - 1])
  for (const index of indexes) assertEqual(values[index], expected[index], `${message}[${index}]`)
}

function readPointer(view: DataView, offset: number): bigint {
  return pointerSize === 8 ? view.getBigUint64(offset, true) : BigInt(view.getUint32(offset, true))
}

function sequence(length: number, multiplier = 1): number[] {
  return Array.from({ length }, (_, index) => (index * multiplier) >>> 0)
}

function scenario(
  name: string,
  description: string,
  category: string,
  source: BenchmarkScenario["source"],
  tier: BenchmarkTier,
  setup: () => BenchmarkRuntime,
): BenchmarkScenario {
  return { name, description, category, source, tier, setup }
}

function packScenario(options: {
  name: string
  description: string
  category: string
  source: BenchmarkScenario["source"]
  tier: BenchmarkTier
  struct: AnyStruct
  value: unknown
  bytes?: number
  workPerOperation?: number
  workLabel?: string
  memoryIterations?: number
  validate?: (buffer: ArrayBuffer) => void
}): BenchmarkScenario {
  return scenario(options.name, options.description, options.category, options.source, options.tier, () => ({
    run: () => options.struct.pack(options.value as any),
    validate: () => {
      const buffer = options.struct.pack(options.value as any)
      assertEqual(buffer.byteLength, options.struct.size, `${options.name} header size`)
      options.validate?.(buffer)
    },
    bytesPerOperation: options.bytes ?? options.struct.size,
    workPerOperation: options.workPerOperation,
    workLabel: options.workLabel,
    memoryIterations: options.memoryIterations,
  }))
}

function unpackScenario(options: {
  name: string
  description: string
  category: string
  source: BenchmarkScenario["source"]
  tier: BenchmarkTier
  struct: AnyStruct
  buffer: ArrayBuffer
  bytes?: number
  workPerOperation?: number
  workLabel?: string
  memoryIterations?: number
  validate: (value: any) => void
}): BenchmarkScenario {
  return scenario(options.name, options.description, options.category, options.source, options.tier, () => ({
    run: () => options.struct.unpack(options.buffer),
    validate: () => options.validate(options.struct.unpack(options.buffer)),
    bytesPerOperation: options.bytes ?? options.struct.size,
    workPerOperation: options.workPerOperation,
    workLabel: options.workLabel,
    memoryIterations: options.memoryIterations,
  }))
}

function packListScenario(options: {
  name: string
  description: string
  category: string
  source: BenchmarkScenario["source"]
  tier: BenchmarkTier
  struct: AnyStruct
  values: unknown[]
  bytes: number
  memoryIterations?: number
  validate?: (buffer: ArrayBuffer) => void
}): BenchmarkScenario {
  return scenario(options.name, options.description, options.category, options.source, options.tier, () => ({
    run: () => options.struct.packList(options.values as any[]),
    validate: () => {
      const buffer = options.struct.packList(options.values as any[])
      assertEqual(buffer.byteLength, options.struct.size * options.values.length, `${options.name} header bytes`)
      options.validate?.(buffer)
    },
    workPerOperation: options.values.length,
    workLabel: "structs",
    bytesPerOperation: options.bytes,
    memoryIterations: options.memoryIterations,
  }))
}

function unpackListScenario(options: {
  name: string
  description: string
  category: string
  source: BenchmarkScenario["source"]
  tier: BenchmarkTier
  struct: AnyStruct
  buffer: ArrayBuffer
  count: number
  bytes?: number
  memoryIterations?: number
  validate: (values: any[]) => void
}): BenchmarkScenario {
  return scenario(options.name, options.description, options.category, options.source, options.tier, () => ({
    run: () => options.struct.unpackList(options.buffer, options.count),
    validate: () => options.validate(options.struct.unpackList(options.buffer, options.count)),
    workPerOperation: options.count,
    workLabel: "structs",
    bytesPerOperation: options.bytes ?? options.struct.size * options.count,
    memoryIterations: options.memoryIterations,
  }))
}

function roundtripScenario(options: {
  name: string
  description: string
  category: string
  source: BenchmarkScenario["source"]
  tier: BenchmarkTier
  struct: AnyStruct
  value: unknown
  bytes?: number
  memoryIterations?: number
  validate: (value: any) => void
}): BenchmarkScenario {
  return scenario(options.name, options.description, options.category, options.source, options.tier, () => ({
    run: () => options.struct.unpack(options.struct.pack(options.value as any)),
    validate: () => options.validate(options.struct.unpack(options.struct.pack(options.value as any))),
    bytesPerOperation: options.bytes ?? options.struct.size,
    memoryIterations: options.memoryIterations,
  }))
}

function roundtripListScenario(options: {
  name: string
  description: string
  category: string
  source: BenchmarkScenario["source"]
  tier: BenchmarkTier
  struct: AnyStruct
  values: unknown[]
  bytes?: number
  memoryIterations?: number
  validate: (values: any[]) => void
}): BenchmarkScenario {
  return scenario(options.name, options.description, options.category, options.source, options.tier, () => ({
    run: () => options.struct.unpackList(options.struct.packList(options.values as any[]), options.values.length),
    validate: () =>
      options.validate(
        options.struct.unpackList(options.struct.packList(options.values as any[]), options.values.length),
      ),
    workPerOperation: options.values.length,
    workLabel: "structs",
    bytesPerOperation: options.bytes ?? options.struct.size * options.values.length,
    memoryIterations: options.memoryIterations,
  }))
}

// OpenTUI production definitions, mirrored from packages/core/src/zig-structs.ts.
type BenchColor = { buffer: Uint16Array }
type StyledChunkInput = {
  text: string
  fg?: BenchColor | null
  bg?: BenchColor | null
  attributes?: number | null
  link?: { url: string } | string | null
}

const rgbaPackTransform = (color?: BenchColor) => color?.buffer ?? null
const rgbaUnpackTransform = (pointer?: Pointer) =>
  pointer ? Array.from(new Uint16Array(toArrayBuffer(pointer, 0, 8))) : undefined
const normalizeBenchColorValue = (value: BenchColor | null | undefined) => (value == null ? null : { rgba: value })

const StyledChunkStruct = defineStruct(
  [
    ["text", "char*"],
    ["text_len", "u64", { lengthOf: "text" }],
    ["fg", "pointer", { optional: true, packTransform: rgbaPackTransform, unpackTransform: rgbaUnpackTransform }],
    ["bg", "pointer", { optional: true, packTransform: rgbaPackTransform, unpackTransform: rgbaUnpackTransform }],
    ["attributes", "u32", { default: 0 }],
    ["link", "char*", { default: "" }],
    ["link_len", "u64", { lengthOf: "link" }],
  ],
  {
    mapValue: (chunk: StyledChunkInput): StyledChunkInput => {
      const normalizedFg = normalizeBenchColorValue(chunk.fg ?? null)
      const normalizedBg = normalizeBenchColorValue(chunk.bg ?? null)
      if (!chunk.link || typeof chunk.link === "string") {
        return { ...chunk, fg: normalizedFg?.rgba ?? null, bg: normalizedBg?.rgba ?? null }
      }
      return {
        ...chunk,
        fg: normalizedFg?.rgba ?? null,
        bg: normalizedBg?.rgba ?? null,
        link: chunk.link.url,
      }
    },
  },
)

const HighlightStruct = defineStruct([
  ["start", "u32"],
  ["end", "u32"],
  ["styleId", "u32"],
  ["priority", "u8", { default: 0 }],
  ["hlRef", "u16", { default: 0 }],
])

const LogicalCursorStruct = defineStruct([
  ["row", "u32"],
  ["col", "u32"],
  ["offset", "u32"],
])

const VisualCursorStruct = defineStruct([
  ["visualRow", "u32"],
  ["visualCol", "u32"],
  ["logicalRow", "u32"],
  ["logicalCol", "u32"],
  ["offset", "u32"],
])

const UnicodeMethodEnum = defineEnum({ wcwidth: 0, unicode: 1 }, "u8")
const TerminalMultiplexerEnum = defineEnum({ none: 0, tmux: 1, zellij: 2, screen: 3, unknown: 4 }, "u8")
const Osc52SupportEnum = defineEnum({ unknown: 0, supported: 1, unsupported: 2 }, "u8")

const TerminalCapabilitiesStruct = defineStruct([
  ["kitty_keyboard", "bool_u8"],
  ["kitty_graphics", "bool_u8"],
  ["rgb", "bool_u8"],
  ["ansi256", "bool_u8"],
  ["unicode", UnicodeMethodEnum],
  ["sgr_pixels", "bool_u8"],
  ["color_scheme_updates", "bool_u8"],
  ["explicit_width", "bool_u8"],
  ["scaled_text", "bool_u8"],
  ["sixel", "bool_u8"],
  ["focus_tracking", "bool_u8"],
  ["sync", "bool_u8"],
  ["bracketed_paste", "bool_u8"],
  ["hyperlinks", "bool_u8"],
  ["osc52", "bool_u8"],
  ["notifications", "bool_u8"],
  ["explicit_cursor_positioning", "bool_u8"],
  ["remote", "bool_u8"],
  ["multiplexer", TerminalMultiplexerEnum],
  ["term_name", "char*"],
  ["term_name_len", "u64", { lengthOf: "term_name" }],
  ["term_version", "char*"],
  ["term_version_len", "u64", { lengthOf: "term_version" }],
  ["term_from_xtversion", "bool_u8"],
  ["osc52_support", Osc52SupportEnum],
])

const EncodedCharStruct = defineStruct([
  ["width", "u8"],
  ["char", "u32"],
])

const LineInfoStruct = defineStruct([
  ["startCols", ["u32"]],
  ["startColsLen", "u32", { lengthOf: "startCols" }],
  ["widthCols", ["u32"]],
  ["widthColsLen", "u32", { lengthOf: "widthCols" }],
  ["sources", ["u32"]],
  ["sourcesLen", "u32", { lengthOf: "sources" }],
  ["wraps", ["u32"]],
  ["wrapsLen", "u32", { lengthOf: "wraps" }],
  ["widthColsMax", "u32"],
])

const MeasureResultStruct = defineStruct([
  ["lineCount", "u32"],
  ["widthColsMax", "u32"],
])

const CursorStateStruct = defineStruct([
  ["x", "u32"],
  ["y", "u32"],
  ["visible", "bool_u8"],
  ["style", "u8"],
  ["blinking", "bool_u8"],
  ["r", "f32"],
  ["g", "f32"],
  ["b", "f32"],
  ["a", "f32"],
])

const CursorStyleOptionsStruct = defineStruct([
  ["style", "u8", { default: 255 }],
  ["blinking", "u8", { default: 255 }],
  ["color", "pointer", { optional: true, packTransform: rgbaPackTransform, unpackTransform: rgbaUnpackTransform }],
  ["cursor", "u8", { default: 255 }],
])

const GridDrawOptionsStruct = defineStruct([
  ["drawInner", "bool_u8", { default: true }],
  ["drawOuter", "bool_u8", { default: true }],
])

const BuildOptionsStruct = defineStruct([
  ["gpaSafeStats", "bool_u8"],
  ["gpaMemoryLimitTracking", "bool_u8"],
])

const AllocatorStatsStruct = defineStruct([
  ["totalRequestedBytes", "u64"],
  ["activeAllocations", "u64"],
  ["smallAllocations", "u64"],
  ["largeAllocations", "u64"],
  ["requestedBytesValid", "bool_u8"],
])

const NativeRenderStatsStruct = defineStruct([
  ["lastFrameTime", "f64"],
  ["averageFrameTime", "f64"],
  ["renderTime", "f64"],
  ["stdoutWriteTime", "f64"],
  ["frameCount", "u64"],
  ["cellsUpdated", "u32"],
  ["averageCellsUpdated", "u32"],
  ["renderTimeValid", "bool_u8"],
  ["stdoutWriteTimeValid", "bool_u8"],
])

const GrowthPolicyEnum = defineEnum({ grow: 0, block: 1 }, "u8")
const NativeSpanFeedOptionsStruct = defineStruct([
  ["chunkSize", "u32", { default: 64 * 1024 }],
  ["initialChunks", "u32", { default: 2 }],
  ["maxBytes", "u64", { default: 0n }],
  ["growthPolicy", GrowthPolicyEnum, { default: "grow" }],
  ["autoCommitOnFull", "bool_u8", { default: true }],
  ["spanQueueCapacity", "u32", { default: 0 }],
])

const NativeSpanFeedStatsStruct = defineStruct([
  ["bytesWritten", "u64"],
  ["spansCommitted", "u64"],
  ["chunks", "u32"],
  ["pendingSpans", "u32"],
])

const SpanInfoStruct = defineStruct(
  [
    ["chunkPtr", "pointer"],
    ["offset", "u32"],
    ["len", "u32"],
    ["chunkIndex", "u32"],
    ["reserved", "u32", { default: 0 }],
  ],
  {
    reduceValue: (value: { chunkPtr: Pointer; offset: number; len: number; chunkIndex: number }) => ({
      chunkPtr: value.chunkPtr,
      offset: value.offset,
      len: value.len,
      chunkIndex: value.chunkIndex,
    }),
  },
)

const ReserveInfoStruct = defineStruct(
  [
    ["ptr", "pointer"],
    ["len", "u32"],
    ["reserved", "u32", { default: 0 }],
  ],
  { reduceValue: (value: { ptr: Pointer; len: number }) => ({ ptr: value.ptr, len: value.len }) },
)

const AudioCreateOptionsStruct = defineStruct([
  ["sampleRate", "u32", { default: 48_000 }],
  ["playbackChannels", "u32", { default: 2 }],
])

const AudioStartOptionsStruct = defineStruct([
  ["periodSizeInFrames", "u32", { default: 0 }],
  ["periodSizeInMilliseconds", "u32", { default: 0 }],
  ["periods", "u32", { default: 0 }],
  ["performanceProfile", "u8", { default: 0 }],
  ["shareMode", "u8", { default: 0 }],
  ["noPreSilencedOutputBuffer", "bool_u8", { default: false }],
  ["noClip", "bool_u8", { default: false }],
  ["noDisableDenormals", "bool_u8", { default: false }],
  ["noFixedSizedCallback", "bool_u8", { default: false }],
  ["wasapiNoAutoConvertSrc", "bool_u8", { default: false }],
  ["wasapiNoDefaultQualitySrc", "bool_u8", { default: false }],
  ["alsaNoMMap", "bool_u8", { default: false }],
  ["alsaNoAutoFormat", "bool_u8", { default: false }],
  ["alsaNoAutoChannels", "bool_u8", { default: false }],
  ["alsaNoAutoResample", "bool_u8", { default: false }],
])

const AudioVoiceOptionsStruct = defineStruct([
  ["volume", "f32", { default: 1 }],
  ["pan", "f32", { default: 0 }],
  ["loop", "bool_u8", { default: false }],
  ["groupId", "u32", { default: 0 }],
])

const AudioStreamCreateOptionsStruct = defineStruct([
  ["capacityMs", "u32"],
  ["startupMs", "u32"],
  ["resumeMs", "u32"],
  ["volume", "f32"],
  ["pan", "f32"],
  ["groupId", "u32"],
  ["maxProbeBytes", "u32"],
  ["format", "u32"],
])

const AudioStreamStatsStruct = defineStruct([
  ["bytesReceived", "u64"],
  ["framesDecoded", "u64"],
  ["framesPlayed", "u64"],
  ["state", "u32"],
  ["sampleRate", "u32"],
  ["channels", "u32"],
  ["bufferedFrames", "u32"],
  ["capacityFrames", "u32"],
  ["underruns", "u32"],
  ["errorCode", "i32"],
  ["readyGeneration", "u32"],
])

const AudioStatsStruct = defineStruct([
  ["soundsLoaded", "u32"],
  ["voicesActive", "u32"],
  ["framesMixed", "u64"],
  ["lockMisses", "u32"],
  ["lastPeak", "f32"],
  ["lastRms", "f32"],
])

// Generic library shapes used to expose scaling, allocation, transform, and validation costs.
const FlatStruct = defineStruct([
  ["id", "u32"],
  ["value", "f64"],
  ["timestamp", "u64"],
  ["active", "bool_u8"],
])
const NestedStruct = defineStruct([
  ["left", FlatStruct],
  ["right", FlatStruct],
  ["sequence", "u32"],
])
const PrimitiveArrayStruct = defineStruct([
  ["count", "u32", { lengthOf: "values" }],
  ["values", ["u32"]],
])
const StringStruct = defineStruct([
  ["text", "char*"],
  ["length", "u64", { lengthOf: "text" }],
])
const TransformedStruct = defineStruct(
  [
    ["value", "u32", { packTransform: (value: number) => value * 2, unpackTransform: (value: number) => value / 2 }],
    [
      "checked",
      "u32",
      {
        default: 1,
        validate: (value) => {
          if (value < 0) throw new Error("checked must be non-negative")
        },
      },
    ],
  ],
  {
    mapValue: (value: { raw: number; checked?: number }) => ({ value: value.raw, checked: value.checked }),
    reduceValue: (value: { value: number; checked: number }) => ({ ...value, total: value.value + value.checked }),
  },
)
const SmallEnum = defineEnum({ idle: 0, active: 1, done: 2 }, "u8")
const EnumArrayStruct = defineStruct([
  ["count", "u32", { lengthOf: "values" }],
  ["values", [SmallEnum]],
])

// Exact schemas and fixtures from the benchmark suite that preceded the OpenTUI expansion.
const LegacySimpleStruct = defineStruct([
  ["id", "u32"],
  ["value", "f64"],
  ["active", "bool_u8"],
])
const LegacyMediumStruct = defineStruct([
  ["id", "u32"],
  ["x", "f32"],
  ["y", "f32"],
  ["z", "f32"],
  ["timestamp", "u64"],
  ["flags", "u32"],
  ["enabled", "bool_u32"],
  ["score", "f64"],
])
const LegacyStatusEnum = defineEnum({ Active: 0, Inactive: 1, Pending: 2, Completed: 3 })
const LegacyNestedStruct = defineStruct([
  ["inner", LegacySimpleStruct],
  ["status", LegacyStatusEnum],
  ["count", "u32"],
])
const LegacyComplexNestedStruct = defineStruct([
  ["header", LegacyMediumStruct],
  ["nested", LegacyNestedStruct],
  ["footer_id", "u32"],
  ["footer_value", "f64"],
])
const LegacyArrayStruct = defineStruct([
  ["count", "u32", { lengthOf: "items" }],
  ["items", ["u32"]],
])
const LegacyLargeArrayStruct = defineStruct([
  ["id", "u32"],
  ["data_len", "u32", { lengthOf: "data" }],
  ["data", ["f32"]],
  ["indices_len", "u32", { lengthOf: "indices" }],
  ["indices", ["u32"]],
])
const LegacyMassiveNestedStruct = defineStruct([
  ["level1", LegacyComplexNestedStruct],
  ["level2", LegacyComplexNestedStruct],
  ["level3", LegacyComplexNestedStruct],
  ["counter", "u64"],
  ["metadata", LegacyMediumStruct],
])

const legacySimpleData = { id: 42, value: 3.14159, active: true }
const legacyMediumData = {
  id: 100,
  x: 1.5,
  y: 2.5,
  z: 3.5,
  timestamp: 1234567890n,
  flags: 0xff00ff00,
  enabled: true,
  score: 99.99,
}
const legacyNestedData = { inner: legacySimpleData, status: "Active" as const, count: 10 }
const legacyComplexNestedData = {
  header: legacyMediumData,
  nested: legacyNestedData,
  footer_id: 999,
  footer_value: 123.456,
}
const legacyMassiveNestedData = {
  level1: legacyComplexNestedData,
  level2: legacyComplexNestedData,
  level3: legacyComplexNestedData,
  counter: 9999999999n,
  metadata: legacyMediumData,
}

const legacyArrayData = new Map(
  [10, 100, 1000, 10_000].map((count) => [count, { count, items: Array.from({ length: count }, (_, index) => index) }]),
)
const legacyLargeArrayData = {
  medium: {
    id: 42,
    data_len: 1000,
    data: Array.from({ length: 1000 }, (_, index) => index * 0.5),
    indices_len: 500,
    indices: Array.from({ length: 500 }, (_, index) => index * 2),
  },
  huge: {
    id: 42,
    data_len: 10_000,
    data: Array.from({ length: 10_000 }, (_, index) => index * 0.5),
    indices_len: 5000,
    indices: Array.from({ length: 5000 }, (_, index) => index * 2),
  },
}
const legacySimpleLists = new Map(
  [10, 100, 1000, 10_000].map((count) => [
    count,
    Array.from({ length: count }, (_, index) => ({ id: index, value: index * 1.5, active: index % 2 === 0 })),
  ]),
)
const legacyMediumLists = new Map(
  [10, 1000].map((count) => [
    count,
    Array.from({ length: count }, (_, index) => ({
      id: index,
      x: index,
      y: index * 2,
      z: index * 3,
      timestamp: BigInt(index * 1000),
      flags: index,
      enabled: index % 2 === 0,
      score: index * 10.5,
    })),
  ]),
)
const legacyComplexLists = new Map([
  [10, Array.from({ length: 10 }, () => legacyComplexNestedData)],
  [100, Array.from({ length: 100 }, () => legacyComplexNestedData)],
])

// bun-webgpu production descriptor graphs, mirrored from src/structs_def.ts.
interface WebGPUHandle {
  ptr: Pointer | null
}

const WEBGPU_STRLEN = 0xffffffffffffffffn
const BunWebGPUStringView = defineStruct(
  [
    ["data", "char*", { optional: true }],
    ["length", "u64"],
  ],
  {
    mapValue: (value: string | null | undefined) =>
      value ? { data: value, length: Buffer.byteLength(value) } : { data: null, length: WEBGPU_STRLEN },
  },
)

const BunWebGPUTextureFormat = defineEnum({ undefined: 0, rgba8unorm: 0x12 }, "u32")
const BunWebGPUBufferBindingType = defineEnum({ "binding-not-used": 0, undefined: 1, uniform: 2, storage: 3 })
const BunWebGPUSamplerBindingType = defineEnum({
  "binding-not-used": 0,
  undefined: 1,
  filtering: 2,
  "non-filtering": 3,
  comparison: 4,
})
const BunWebGPUTextureSampleType = defineEnum({
  "binding-not-used": 0,
  undefined: 1,
  float: 2,
  "unfilterable-float": 3,
  depth: 4,
  sint: 5,
  uint: 6,
})
const BunWebGPUTextureViewDimension = defineEnum({
  undefined: 0,
  "1d": 1,
  "2d": 2,
  "2d-array": 3,
  cube: 4,
  "cube-array": 5,
  "3d": 6,
})
const BunWebGPUStorageTextureAccess = defineEnum({
  "binding-not-used": 0,
  undefined: 1,
  "write-only": 2,
  "read-only": 3,
  "read-write": 4,
})

const BunWebGPUBufferBindingLayoutStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["type", BunWebGPUBufferBindingType, { default: "uniform" }],
  ["hasDynamicOffset", "bool_u32", { default: false }],
  ["minBindingSize", "u64", { default: 0 }],
])
const BunWebGPUSamplerBindingLayoutStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["type", BunWebGPUSamplerBindingType, { default: "filtering" }],
])
const BunWebGPUTextureBindingLayoutStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["sampleType", BunWebGPUTextureSampleType, { default: "float" }],
  ["viewDimension", BunWebGPUTextureViewDimension, { default: "2d" }],
  ["multisampled", "bool_u32", { default: false }],
])
const BunWebGPUStorageTextureBindingLayoutStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["access", BunWebGPUStorageTextureAccess, { default: "write-only" }],
  ["format", BunWebGPUTextureFormat, { default: "rgba8unorm" }],
  ["viewDimension", BunWebGPUTextureViewDimension, { default: "2d" }],
])
const BunWebGPUBindGroupLayoutEntryStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["binding", "u32"],
  ["visibility", "u64"],
  ["_alignment0", "u32", { default: 0, condition: () => process.platform !== "win32" }],
  ["buffer", BunWebGPUBufferBindingLayoutStruct, { optional: true }],
  ["sampler", BunWebGPUSamplerBindingLayoutStruct, { optional: true }],
  ["texture", BunWebGPUTextureBindingLayoutStruct, { optional: true }],
  ["storageTexture", BunWebGPUStorageTextureBindingLayoutStruct, { optional: true }],
])
const BunWebGPUBindGroupLayoutDescriptorStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["label", BunWebGPUStringView, { optional: true }],
  ["entryCount", "u64", { lengthOf: "entries" }],
  ["entries", [BunWebGPUBindGroupLayoutEntryStruct]],
])

const BunWebGPUVertexStepMode = defineEnum({ undefined: 0, vertex: 1, instance: 2 })
const BunWebGPUPrimitiveTopology = defineEnum({ undefined: 0, "triangle-list": 4 })
const BunWebGPUIndexFormat = defineEnum({ undefined: 0, uint16: 1, uint32: 2 })
const BunWebGPUFrontFace = defineEnum({ undefined: 0, ccw: 1, cw: 2 })
const BunWebGPUCullMode = defineEnum({ undefined: 0, none: 1, front: 2, back: 3 })
const BunWebGPUVertexFormat = defineEnum({ float32x3: 0x1e }, "u32")
const BunWebGPUBlendOperation = defineEnum({ undefined: 0, add: 1 })
const BunWebGPUBlendFactor = defineEnum({ undefined: 0, zero: 1, one: 2 })
const BunWebGPUCompareFunction = defineEnum({ undefined: 0, always: 8 })
const BunWebGPUStencilOperation = defineEnum({ undefined: 0, keep: 1 })

const BunWebGPUConstantEntryStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["key", BunWebGPUStringView],
  [
    "value",
    "f64",
    {
      validate: (value: number) => {
        if (!Number.isFinite(value)) throw new TypeError("Pipeline constant value must be finite")
      },
    },
  ],
])
const BunWebGPUVertexAttributeStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["format", BunWebGPUVertexFormat],
  ["offset", "u64"],
  ["shaderLocation", "u32"],
])
const BunWebGPUVertexBufferLayoutStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["stepMode", BunWebGPUVertexStepMode, { default: "vertex" }],
  ["arrayStride", "u64"],
  ["attributeCount", "u64", { lengthOf: "attributes" }],
  ["attributes", [BunWebGPUVertexAttributeStruct]],
])
const BunWebGPUVertexStateStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["module", objectPtr<WebGPUHandle>()],
  ["entryPoint", BunWebGPUStringView, { optional: true, mapOptionalInline: true }],
  ["constantCount", "u64", { lengthOf: "constants" }],
  ["constants", [BunWebGPUConstantEntryStruct], { optional: true }],
  ["bufferCount", "u64", { lengthOf: "buffers" }],
  ["buffers", [BunWebGPUVertexBufferLayoutStruct], { optional: true }],
])
const BunWebGPUPrimitiveStateStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["topology", BunWebGPUPrimitiveTopology, { default: "triangle-list" }],
  ["stripIndexFormat", BunWebGPUIndexFormat, { default: "undefined" }],
  ["frontFace", BunWebGPUFrontFace, { default: "ccw" }],
  ["cullMode", BunWebGPUCullMode, { default: "none" }],
  ["unclippedDepth", "bool_u32", { optional: true }],
])
const BunWebGPUStencilFaceStateStruct = defineStruct([
  ["compare", BunWebGPUCompareFunction, { default: "always" }],
  ["failOp", BunWebGPUStencilOperation, { default: "keep" }],
  ["depthFailOp", BunWebGPUStencilOperation, { default: "keep" }],
  ["passOp", BunWebGPUStencilOperation, { default: "keep" }],
])
const BunWebGPUDepthStencilStateStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["format", BunWebGPUTextureFormat],
  ["depthWriteEnabled", "bool_u32", { default: false }],
  ["depthCompare", BunWebGPUCompareFunction, { default: "always" }],
  ["stencilFront", BunWebGPUStencilFaceStateStruct, { default: {} }],
  ["stencilBack", BunWebGPUStencilFaceStateStruct, { default: {} }],
  ["stencilReadMask", "u32", { default: 0xffffffff }],
  ["stencilWriteMask", "u32", { default: 0xffffffff }],
  ["depthBias", "i32", { default: 0 }],
  ["depthBiasSlopeScale", "f32", { default: 0 }],
  ["depthBiasClamp", "f32", { default: 0 }],
])
const BunWebGPUMultisampleStateStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["count", "u32", { default: 1 }],
  ["mask", "u32", { default: 0xffffffff }],
  ["alphaToCoverageEnabled", "bool_u32", { default: false }],
])
const BunWebGPUBlendComponentStruct = defineStruct([
  ["operation", BunWebGPUBlendOperation, { default: "add" }],
  ["srcFactor", BunWebGPUBlendFactor, { default: "one" }],
  ["dstFactor", BunWebGPUBlendFactor, { default: "zero" }],
])
const BunWebGPUBlendStateStruct = defineStruct([
  ["color", BunWebGPUBlendComponentStruct],
  ["alpha", BunWebGPUBlendComponentStruct],
])
const BunWebGPUColorTargetStateStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["format", BunWebGPUTextureFormat],
  ["blend", BunWebGPUBlendStateStruct, { optional: true, asPointer: true }],
  ["writeMask", "u64", { default: 0xfn }],
])
const BunWebGPUFragmentStateStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["module", objectPtr<WebGPUHandle>()],
  ["entryPoint", BunWebGPUStringView, { optional: true, mapOptionalInline: true }],
  ["constantCount", "u64", { lengthOf: "constants" }],
  ["constants", [BunWebGPUConstantEntryStruct], { optional: true }],
  ["targetCount", "u64", { lengthOf: "targets" }],
  ["targets", [BunWebGPUColorTargetStateStruct]],
])
const BunWebGPURenderPipelineDescriptorStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["label", BunWebGPUStringView, { optional: true }],
  ["layout", objectPtr<WebGPUHandle>(), { optional: true }],
  ["vertex", BunWebGPUVertexStateStruct],
  ["primitive", BunWebGPUPrimitiveStateStruct, { default: {} }],
  ["depthStencil", BunWebGPUDepthStencilStateStruct, { optional: true, asPointer: true }],
  ["multisample", BunWebGPUMultisampleStateStruct, { default: {} }],
  ["fragment", BunWebGPUFragmentStateStruct, { optional: true, asPointer: true }],
])

const BunWebGPULoadOp = defineEnum({ undefined: 0, load: 1, clear: 2 }, "u32")
const BunWebGPUStoreOp = defineEnum({ undefined: 0, store: 1, discard: 2 }, "u32")
const BunWebGPUColorStruct = defineStruct(
  [
    ["r", "f64"],
    ["g", "f64"],
    ["b", "f64"],
    ["a", "f64"],
  ],
  {
    default: { r: 0, g: 0, b: 0, a: 0 },
    mapValue: (value?: { r: number; g: number; b: number; a: number } | number[]) => {
      if (!value) return null
      return Array.isArray(value) ? { r: value[0], g: value[1], b: value[2], a: value[3] } : value
    },
  },
)
const BunWebGPURenderPassColorAttachmentStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["view", objectPtr<WebGPUHandle>()],
  ["depthSlice", "u32", { default: 0xffffffff }],
  ["resolveTarget", objectPtr<WebGPUHandle>(), { optional: true }],
  ["loadOp", BunWebGPULoadOp],
  ["storeOp", BunWebGPUStoreOp],
  ["clearValue", BunWebGPUColorStruct, { default: { r: 0, g: 0, b: 0, a: 0 } }],
])
const BunWebGPURenderPassDepthStencilAttachmentStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["view", objectPtr<WebGPUHandle>()],
  ["depthLoadOp", BunWebGPULoadOp, { optional: true }],
  ["depthStoreOp", BunWebGPUStoreOp, { optional: true }],
  ["depthClearValue", "f32", { default: Number.NaN }],
  ["depthReadOnly", "bool_u32", { default: false }],
  ["stencilLoadOp", BunWebGPULoadOp, { optional: true }],
  ["stencilStoreOp", BunWebGPUStoreOp, { optional: true }],
  ["stencilClearValue", "u32", { default: 0 }],
  ["stencilReadOnly", "bool_u32", { default: false }],
])
const BunWebGPUPassTimestampWritesStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["querySet", objectPtr<WebGPUHandle>()],
  ["beginningOfPassWriteIndex", "u32", { default: 0xffffffff }],
  ["endOfPassWriteIndex", "u32", { default: 0xffffffff }],
])
const BunWebGPURenderPassDescriptorStruct = defineStruct([
  ["nextInChain", "pointer", { optional: true }],
  ["label", BunWebGPUStringView, { optional: true }],
  ["colorAttachmentCount", "u64", { lengthOf: "colorAttachments" }],
  ["colorAttachments", [BunWebGPURenderPassColorAttachmentStruct], { optional: true }],
  ["depthStencilAttachment", BunWebGPURenderPassDepthStencilAttachmentStruct, { optional: true, asPointer: true }],
  ["occlusionQuerySet", objectPtr<WebGPUHandle>(), { optional: true }],
  ["timestampWrites", BunWebGPUPassTimestampWritesStruct, { optional: true, asPointer: true }],
])

const BunWebGPUTextureAspect = defineEnum({ undefined: 0, all: 1 }, "u32")
const BunWebGPUOrigin3DStruct = defineStruct(
  [
    ["x", "u32", { default: 0 }],
    ["y", "u32", { default: 0 }],
    ["z", "u32", { default: 0 }],
  ],
  {
    mapValue: (value: Iterable<number> | { x?: number; y?: number; z?: number }) => {
      if (Symbol.iterator in value) {
        const array = Array.from(value as Iterable<number>)
        return { x: array[0] ?? 0, y: array[1] ?? 0, z: array[2] ?? 0 }
      }
      return value
    },
  },
)
const BunWebGPUExtent3DStruct = defineStruct(
  [
    ["width", "u32"],
    ["height", "u32", { default: 1 }],
    ["depthOrArrayLayers", "u32", { default: 1 }],
  ],
  {
    mapValue: (value: Iterable<number> | { width: number; height?: number; depthOrArrayLayers?: number }) => {
      if (Symbol.iterator in value) {
        const array = Array.from(value as Iterable<number>)
        return { width: array[0] ?? 1, height: array[1] ?? 1, depthOrArrayLayers: array[2] ?? 1 }
      }
      return value
    },
  },
)
const BunWebGPUTexelCopyBufferLayoutStruct = defineStruct([
  ["offset", "u64", { default: 0 }],
  ["bytesPerRow", "u32", { default: 0xffffffff }],
  ["rowsPerImage", "u32", { default: 0xffffffff }],
])
const BunWebGPUTexelCopyBufferInfoStruct = defineStruct(
  [
    ["layout", BunWebGPUTexelCopyBufferLayoutStruct],
    ["buffer", objectPtr<WebGPUHandle>()],
  ],
  {
    mapValue: (value: { buffer: WebGPUHandle; offset?: number; bytesPerRow: number; rowsPerImage: number }) => ({
      layout: {
        offset: value.offset ?? 0,
        bytesPerRow: value.bytesPerRow,
        rowsPerImage: value.rowsPerImage,
      },
      buffer: value.buffer,
    }),
  },
)
const BunWebGPUTexelCopyTextureInfoStruct = defineStruct([
  ["texture", objectPtr<WebGPUHandle>()],
  ["mipLevel", "u32", { default: 0 }],
  ["origin", BunWebGPUOrigin3DStruct, { default: { x: 0, y: 0, z: 0 } }],
  ["aspect", BunWebGPUTextureAspect, { default: "all" }],
])

const bunWebGPUCommandBuffers: WebGPUHandle[] = [{ ptr: 0x100000 }]
const bunWebGPUBindGroupLayoutValue = {
  label: "Test Basic Texture+Sampler BGL",
  entries: [
    { binding: 2, visibility: 2n, texture: {} },
    { binding: 1, visibility: 2n, sampler: {} },
  ],
}
const bunWebGPURenderPipelineValue = {
  layout: { ptr: 0x100000 },
  vertex: {
    module: { ptr: 0x110000 },
    constants: [],
    buffers: [
      {
        arrayStride: 12,
        attributes: [{ format: "float32x3" as const, offset: 0, shaderLocation: 0 }],
      },
    ],
  },
  fragment: {
    module: { ptr: 0x120000 },
    constants: [],
    targets: [{ format: "rgba8unorm" as const }],
  },
  primitive: { topology: "triangle-list" as const },
}
const bunWebGPURenderPassValue = {
  colorAttachments: [
    {
      view: { ptr: 0x200000 },
      loadOp: "clear" as const,
      storeOp: "store" as const,
      clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
    },
  ],
}
const bunWebGPUTextureCopyValue = {
  source: { texture: { ptr: 0x300000 } },
  destination: { buffer: { ptr: 0x310000 }, bytesPerRow: 512, rowsPerImage: 128 },
  extent: { width: 128, height: 128 },
}

const red: BenchColor = { buffer: new Uint16Array([65535, 0, 0, 65535]) }
const green: BenchColor = { buffer: new Uint16Array([0, 65535, 0, 65535]) }
const blue: BenchColor = { buffer: new Uint16Array([0, 0, 65535, 65535]) }

function makeStyledChunks(count: number): StyledChunkInput[] {
  if (count === 1) return [{ text: "plain terminal text" }]
  return Array.from({ length: count }, (_, index) => ({
    text:
      index % 4 === 0
        ? `const value_${index} = "OpenTUI 🌍"`
        : index % 4 === 1
          ? `plain terminal text ${index}`
          : index % 4 === 2
            ? `リンク-${index}`
            : `status ${index}: ready`,
    fg: index % 3 === 0 ? red : index % 3 === 1 ? green : blue,
    bg: index % 5 === 0 ? blue : null,
    attributes: index % 8,
    link: index % 7 === 0 ? { url: `https://example.com/item/${index}` } : null,
  }))
}

function styledBytes(chunks: StyledChunkInput[]): number {
  return (
    chunks.length * StyledChunkStruct.size +
    chunks.reduce((total, chunk) => {
      const link = typeof chunk.link === "string" ? chunk.link : (chunk.link?.url ?? "")
      return total + Buffer.byteLength(chunk.text) + Buffer.byteLength(link) + (chunk.fg ? 8 : 0) + (chunk.bg ? 8 : 0)
    }, 0)
  )
}

function makeSpanInfo(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    chunkPtr: 0x100000 + index * 4096,
    offset: index * 13,
    len: 8 + (index % 64),
    chunkIndex: index >>> 4,
  }))
}

function makeHighlights(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    start: index * 7,
    end: index * 7 + 5,
    styleId: index % 12,
    priority: index % 4,
    hlRef: index,
  }))
}

function makeEncodedChars(count: number) {
  return Array.from({ length: count }, (_, index) => ({ width: index % 5 === 0 ? 2 : 1, char: 0x20 + (index % 0x5f) }))
}

function makeLineInfo(count: number) {
  const startCols = sequence(count, 4)
  const widthCols = Array.from({ length: count }, (_, index) => 1 + (index % 8))
  const sources = sequence(count, 3)
  const wraps = Array.from({ length: count }, (_, index) => (index % 5 === 0 ? 1 : 0))
  return { startCols, widthCols, sources, wraps, widthColsMax: 120 }
}

function makeFlatList(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    value: index * 1.25,
    timestamp: BigInt(index * 1000),
    active: index % 2 === 0,
  }))
}

const flatValue = { id: 42, value: 3.14159, timestamp: 1_725_000_000_000n, active: true }
const nestedValue = { left: flatValue, right: { ...flatValue, id: 43 }, sequence: 7 }
const audioStreamStatsValue = {
  bytesReceived: 4_194_304n,
  framesDecoded: 196_608n,
  framesPlayed: 131_072n,
  state: 2,
  sampleRate: 48_000,
  channels: 2,
  bufferedFrames: 4096,
  capacityFrames: 96_000,
  underruns: 1,
  errorCode: 0,
  readyGeneration: 3,
}
const terminalCapabilitiesValue = {
  kitty_keyboard: true,
  kitty_graphics: true,
  rgb: true,
  ansi256: true,
  unicode: "unicode" as const,
  sgr_pixels: false,
  color_scheme_updates: true,
  explicit_width: true,
  scaled_text: false,
  sixel: false,
  focus_tracking: true,
  sync: true,
  bracketed_paste: true,
  hyperlinks: true,
  osc52: true,
  notifications: false,
  explicit_cursor_positioning: true,
  remote: false,
  multiplexer: "tmux" as const,
  term_name: "xterm-kitty",
  term_version: "0.39.1",
  term_from_xtversion: true,
  osc52_support: "supported" as const,
}

export const scenarios: BenchmarkScenario[] = []

for (const count of [1, 16, 128, 1024]) {
  const chunks = makeStyledChunks(count)
  scenarios.push(
    packListScenario({
      name: `opentui/styled-chunks/pack-list/${count}`,
      description:
        count === 1
          ? "OpenTUI's exact one-chunk plain-string StyledChunkStruct.packList path"
          : `OpenTUI StyledChunkStruct.packList with pre-normalized RGBA owners, UTF-8, attributes, and links (${count} chunks)`,
      category: "styled-text",
      source: "opentui",
      tier: count === 1 ? "core" : count <= 128 ? "extended" : "stress",
      struct: StyledChunkStruct,
      values: chunks,
      bytes: styledBytes(chunks),
      memoryIterations: count === 1 ? 5_000 : count === 16 ? 500 : count === 128 ? 50 : 10,
      validate: (buffer) => {
        const view = new DataView(buffer)
        const first = chunks[0]!
        assertEqual(
          view.getBigUint64(StyledChunkStruct.layoutByName.get("text_len")!.offset, true),
          BigInt(Buffer.byteLength(first.text)),
          "styled text byte length",
        )
        assertEqual(
          readPointer(view, StyledChunkStruct.layoutByName.get("fg")!.offset) !== 0n,
          Boolean(first.fg),
          "styled fg pointer presence",
        )
      },
    }),
  )
}

const audioStreamStatsBuffer = AudioStreamStatsStruct.pack(audioStreamStatsValue)
scenarios.push(
  unpackScenario({
    name: "opentui/audio-stream-stats/unpack",
    description: "56-byte audio stream stats snapshot used by 5 ms readiness/backpressure polling",
    category: "audio",
    source: "opentui",
    tier: "core",
    struct: AudioStreamStatsStruct,
    buffer: audioStreamStatsBuffer,
    validate: (value) => {
      assertEqual(value.bytesReceived, audioStreamStatsValue.bytesReceived, "audio bytesReceived")
      assertEqual(value.errorCode, 0, "audio errorCode")
    },
  }),
)

for (const count of [1, 64, 256]) {
  const values = makeSpanInfo(count)
  const buffer = SpanInfoStruct.packList(values)
  scenarios.push(
    unpackListScenario({
      name: `opentui/span-info/unpack-list/${count}`,
      description: `NativeSpanFeed drain records with pointer decoding and reduceValue (${count}, production maximum 256)`,
      category: "native-span-feed",
      source: "opentui",
      tier: count === 1 || count === 256 ? "core" : "extended",
      struct: SpanInfoStruct,
      buffer,
      count,
      validate: (output) => {
        assertEqual(output.length, count, "span count")
        assertEqual(output[0]?.offset, 0, "first span offset")
        assertEqual(output[count - 1]?.len, values[count - 1]?.len, "last span len")
        assert(!("reserved" in output[0]!), "SpanInfo reduceValue must remove reserved")
      },
    }),
  )
}

for (const count of [24, 60, 1000, 10_000]) {
  const value = makeLineInfo(count)
  const buffer = LineInfoStruct.pack(value)
  scenarios.push(
    unpackScenario({
      name: `opentui/line-info/unpack/${count}`,
      description: `LineInfoStruct with four native u32 arrays (${count} visual lines)`,
      category: "text-layout",
      source: "opentui",
      tier: count <= 60 ? "core" : count === 1000 ? "extended" : "stress",
      struct: LineInfoStruct,
      buffer,
      bytes: LineInfoStruct.size + count * 16,
      workPerOperation: Math.max(1, count),
      workLabel: "visual lines",
      memoryIterations: count <= 60 ? 2_000 : count === 1000 ? 100 : 10,
      validate: (output) => {
        assertArraySample(output.startCols, value.startCols, "startCols")
        assertArraySample(output.widthCols, value.widthCols, "widthCols")
        assertArraySample(output.sources, value.sources, "sources")
        assertArraySample(output.wraps, value.wraps, "wraps")
      },
    }),
  )
}

const logicalCursorValue = { row: 120, col: 42, offset: 8192 }
const visualCursorValue = { visualRow: 20, visualCol: 12, logicalRow: 120, logicalCol: 42, offset: 8192 }
scenarios.push(
  unpackScenario({
    name: "opentui/logical-cursor/unpack",
    description: "Logical cursor read used by cursor, word-boundary, EOL, and offset APIs",
    category: "cursor",
    source: "opentui",
    tier: "core",
    struct: LogicalCursorStruct,
    buffer: LogicalCursorStruct.pack(logicalCursorValue),
    validate: (value) => assertEqual(value.offset, logicalCursorValue.offset, "logical cursor offset"),
  }),
  unpackScenario({
    name: "opentui/visual-cursor/unpack",
    description: "Visual cursor read used during focused editor rendering and selection movement",
    category: "cursor",
    source: "opentui",
    tier: "core",
    struct: VisualCursorStruct,
    buffer: VisualCursorStruct.pack(visualCursorValue),
    validate: (value) => assertEqual(value.logicalRow, visualCursorValue.logicalRow, "visual cursor logicalRow"),
  }),
)

const measureBuffer = MeasureResultStruct.pack({ lineCount: 6, widthColsMax: 87 })
scenarios.push(
  unpackScenario({
    name: "opentui/measure-result/unpack",
    description: "Single table-cell text measurement result",
    category: "text-measure",
    source: "opentui",
    tier: "core",
    struct: MeasureResultStruct,
    buffer: measureBuffer,
    validate: (value) => assertEqual(value.widthColsMax, 87, "measure width"),
  }),
  scenario(
    "opentui/measure-result/unpack-batch/200",
    "Isolated struct-unpack component of 200 measurement results; excludes native calls and table layout work",
    "text-measure",
    "opentui",
    "core",
    () => ({
      run: () => {
        let checksum = 0
        for (let index = 0; index < 200; index += 1) checksum += MeasureResultStruct.unpack(measureBuffer).widthColsMax
        return checksum
      },
      validate: () => assertEqual(MeasureResultStruct.unpack(measureBuffer).lineCount, 6, "measure lineCount"),
      workPerOperation: 200,
      workLabel: "measurements",
      bytesPerOperation: MeasureResultStruct.size * 200,
      memoryIterations: 100,
    }),
  ),
)

const highlights64 = makeHighlights(64)
const highlights4096 = makeHighlights(4096)
scenarios.push(
  packScenario({
    name: "opentui/highlight/pack",
    description: "Single fully populated extmark highlight pack",
    category: "highlights",
    source: "opentui",
    tier: "core",
    struct: HighlightStruct,
    value: highlights64[0],
  }),
  unpackListScenario({
    name: "opentui/highlight/unpack-list/64",
    description: "Native highlight retrieval for 64 records",
    category: "highlights",
    source: "opentui",
    tier: "extended",
    struct: HighlightStruct,
    buffer: HighlightStruct.packList(highlights64),
    count: highlights64.length,
    validate: (values) => assertEqual(values[63]?.hlRef, 63, "last highlight reference"),
  }),
  unpackListScenario({
    name: "opentui/highlight/unpack-list/4096",
    description: "Stress retrieval of 4096 native highlight records",
    category: "highlights",
    source: "opentui",
    tier: "stress",
    struct: HighlightStruct,
    buffer: HighlightStruct.packList(highlights4096),
    count: highlights4096.length,
    memoryIterations: 20,
    validate: (values) => assertEqual(values[4095]?.hlRef, 4095, "last stress highlight reference"),
  }),
)

scenarios.push(
  packScenario({
    name: "opentui/cursor-style/pack/sentinel",
    description: "Focused editor cursor-style pack using all default sentinel values",
    category: "cursor",
    source: "opentui",
    tier: "extended",
    struct: CursorStyleOptionsStruct,
    value: {},
  }),
  packScenario({
    name: "opentui/cursor-style/pack/color",
    description: "Focused editor cursor-style pack with an owning RGBA pointer transform",
    category: "cursor",
    source: "opentui",
    tier: "extended",
    struct: CursorStyleOptionsStruct,
    value: { style: 2, blinking: 1, color: green, cursor: 3 },
    bytes: CursorStyleOptionsStruct.size + 8,
  }),
)

const terminalCapabilitiesBuffer = TerminalCapabilitiesStruct.pack(terminalCapabilitiesValue)
scenarios.push(
  unpackScenario({
    name: "opentui/terminal-capabilities/unpack",
    description: "Boolean-heavy terminal capability snapshot with u8 enums and two UTF-8 strings",
    category: "terminal",
    source: "opentui",
    tier: "extended",
    struct: TerminalCapabilitiesStruct,
    buffer: terminalCapabilitiesBuffer,
    bytes:
      TerminalCapabilitiesStruct.size +
      Buffer.byteLength(terminalCapabilitiesValue.term_name) +
      Buffer.byteLength(terminalCapabilitiesValue.term_version),
    validate: (value) => {
      assertEqual(value.term_name, terminalCapabilitiesValue.term_name, "terminal name")
      assertEqual(value.multiplexer, "tmux", "terminal multiplexer")
    },
  }),
)

scenarios.push(
  packScenario({
    name: "opentui/grid-options/pack",
    description: "Two-byte grid draw options used by dirty table border rendering",
    category: "grid",
    source: "opentui",
    tier: "extended",
    struct: GridDrawOptionsStruct,
    value: { drawInner: true, drawOuter: false },
  }),
  packScenario({
    name: "opentui/native-span-options/pack/custom",
    description: "Explicit NativeSpanFeed custom-option pack; the renderer's default create path passes null instead",
    category: "native-span-feed",
    source: "opentui",
    tier: "extended",
    struct: NativeSpanFeedOptionsStruct,
    value: {
      chunkSize: 128 * 1024,
      initialChunks: 4,
      maxBytes: 16n * 1024n * 1024n,
      growthPolicy: "block",
      autoCommitOnFull: false,
      spanQueueCapacity: 512,
    },
  }),
  packScenario({
    name: "opentui/audio-stream-create/pack",
    description: "Resolved audio stream creation options used for every stream",
    category: "audio",
    source: "opentui",
    tier: "extended",
    struct: AudioStreamCreateOptionsStruct,
    value: {
      capacityMs: 2000,
      startupMs: 1000,
      resumeMs: 1000,
      volume: 1,
      pan: 0,
      groupId: 0,
      maxProbeBytes: 1024 * 1024,
      format: 1,
    },
  }),
  packScenario({
    name: "opentui/audio-voice-options/pack",
    description: "Per-play audio voice options with volume, pan, loop, and group",
    category: "audio",
    source: "opentui",
    tier: "extended",
    struct: AudioVoiceOptionsStruct,
    value: { volume: 0.8, pan: -0.25, loop: false, groupId: 2 },
  }),
)

const encoded128 = makeEncodedChars(128)
const encoded4096 = makeEncodedChars(4096)
scenarios.push(
  unpackListScenario({
    name: "opentui/encoded-char/unpack-list/128",
    description: "Unicode encoder output list with 128 width/codepoint records",
    category: "unicode",
    source: "opentui",
    tier: "extended",
    struct: EncodedCharStruct,
    buffer: EncodedCharStruct.packList(encoded128),
    count: encoded128.length,
    validate: (values) => assertEqual(values[127]?.char, encoded128[127]?.char, "last encoded char"),
  }),
  unpackListScenario({
    name: "opentui/encoded-char/unpack-list/4096",
    description: "Stress Unicode encoder output list with 4096 records",
    category: "unicode",
    source: "opentui",
    tier: "stress",
    struct: EncodedCharStruct,
    buffer: EncodedCharStruct.packList(encoded4096),
    count: encoded4096.length,
    memoryIterations: 20,
    validate: (values) => assertEqual(values[4095]?.char, encoded4096[4095]?.char, "last stress encoded char"),
  }),
)

const cursorStateValue = { x: 10, y: 20, visible: true, style: 2, blinking: true, r: 1, g: 0.5, b: 0.25, a: 1 }
const renderStatsValue = {
  lastFrameTime: 2.4,
  averageFrameTime: 2.1,
  renderTime: 1.4,
  stdoutWriteTime: 0.4,
  frameCount: 1000n,
  cellsUpdated: 420,
  averageCellsUpdated: 380,
  renderTimeValid: true,
  stdoutWriteTimeValid: true,
}

scenarios.push(
  unpackScenario({
    name: "opentui/cursor-state/unpack",
    description: "Native cursor state including RGBA floats",
    category: "cursor",
    source: "opentui",
    tier: "stress",
    struct: CursorStateStruct,
    buffer: CursorStateStruct.pack(cursorStateValue),
    validate: (value) => assertEqual(value.visible, true, "cursor visibility"),
  }),
  unpackScenario({
    name: "opentui/native-render-stats/unpack",
    description: "Explicit renderer native statistics snapshot",
    category: "stats",
    source: "opentui",
    tier: "stress",
    struct: NativeRenderStatsStruct,
    buffer: NativeRenderStatsStruct.pack(renderStatsValue),
    validate: (value) => assertEqual(value.frameCount, 1000n, "render frame count"),
  }),
  unpackScenario({
    name: "opentui/allocator-stats/unpack",
    description: "Native allocator statistics snapshot",
    category: "stats",
    source: "opentui",
    tier: "stress",
    struct: AllocatorStatsStruct,
    buffer: AllocatorStatsStruct.pack({
      totalRequestedBytes: 64_000_000n,
      activeAllocations: 1200n,
      smallAllocations: 1000n,
      largeAllocations: 200n,
      requestedBytesValid: true,
    }),
    validate: (value) => assertEqual(value.activeAllocations, 1200n, "active allocation count"),
  }),
  unpackScenario({
    name: "opentui/native-span-stats/unpack",
    description: "Explicit NativeSpanFeed statistics snapshot",
    category: "native-span-feed",
    source: "opentui",
    tier: "stress",
    struct: NativeSpanFeedStatsStruct,
    buffer: NativeSpanFeedStatsStruct.pack({
      bytesWritten: 1_000_000n,
      spansCommitted: 4096n,
      chunks: 8,
      pendingSpans: 4,
    }),
    validate: (value) => assertEqual(value.spansCommitted, 4096n, "committed span count"),
  }),
  unpackScenario({
    name: "opentui/reserve-info/unpack",
    description: "NativeSpanFeed reservation result with reduceValue",
    category: "native-span-feed",
    source: "opentui",
    tier: "stress",
    struct: ReserveInfoStruct,
    buffer: ReserveInfoStruct.pack({ ptr: 0x123456, len: 4096 }),
    validate: (value) => {
      assertEqual(value.len, 4096, "reserve length")
      assert(!("reserved" in value), "ReserveInfo reduceValue must remove reserved")
    },
  }),
)

scenarios.push(
  packScenario({
    name: "opentui/audio-create-options/pack/explicit",
    description: "Explicit audio engine creation options; omitted options bypass packing in OpenTUI",
    category: "audio",
    source: "opentui",
    tier: "stress",
    struct: AudioCreateOptionsStruct,
    value: { sampleRate: 44_100, playbackChannels: 2 },
  }),
  packScenario({
    name: "opentui/audio-start-options/pack/full",
    description: "Full cross-platform audio start option set",
    category: "audio",
    source: "opentui",
    tier: "stress",
    struct: AudioStartOptionsStruct,
    value: {
      periodSizeInFrames: 256,
      periodSizeInMilliseconds: 0,
      periods: 3,
      performanceProfile: 1,
      shareMode: 0,
      noPreSilencedOutputBuffer: true,
      noClip: true,
      noDisableDenormals: false,
      noFixedSizedCallback: false,
      wasapiNoAutoConvertSrc: false,
      wasapiNoDefaultQualitySrc: false,
      alsaNoMMap: false,
      alsaNoAutoFormat: false,
      alsaNoAutoChannels: false,
      alsaNoAutoResample: false,
    },
  }),
  unpackScenario({
    name: "opentui/audio-stats/unpack",
    description: "Explicit global audio statistics snapshot",
    category: "audio",
    source: "opentui",
    tier: "stress",
    struct: AudioStatsStruct,
    buffer: AudioStatsStruct.pack({
      soundsLoaded: 12,
      voicesActive: 4,
      framesMixed: 1_000_000n,
      lockMisses: 2,
      lastPeak: 0.8,
      lastRms: 0.2,
    }),
    validate: (value) => assertEqual(value.framesMixed, 1_000_000n, "audio mixed frames"),
  }),
  unpackScenario({
    name: "opentui/build-options/unpack",
    description: "Build-option feature flags read during setup",
    category: "stats",
    source: "opentui",
    tier: "stress",
    struct: BuildOptionsStruct,
    buffer: BuildOptionsStruct.pack({ gpaSafeStats: true, gpaMemoryLimitTracking: false }),
    validate: (value) => assertEqual(value.gpaSafeStats, true, "gpa safe stats flag"),
  }),
)

// Generic library microbenchmarks and scaling curves.
const flatBuffer = FlatStruct.pack(flatValue)
scenarios.push(
  packScenario({
    name: "library/flat/pack",
    description: "Allocate and pack mixed scalar primitives",
    category: "flat",
    source: "library",
    tier: "core",
    struct: FlatStruct,
    value: flatValue,
  }),
  unpackScenario({
    name: "library/flat/unpack-only",
    description: "Unpack a prebuilt flat scalar buffer without repacking inside timing",
    category: "flat",
    source: "library",
    tier: "core",
    struct: FlatStruct,
    buffer: flatBuffer,
    validate: (value) => assertEqual(value.timestamp, flatValue.timestamp, "flat timestamp"),
  }),
  scenario(
    "library/flat/pack-into",
    "Pack into rotating slots in a preallocated DataView",
    "flat",
    "library",
    "core",
    () => {
      const buffer = new ArrayBuffer(FlatStruct.size)
      const view = new DataView(buffer)
      return {
        run: () => {
          FlatStruct.packInto(flatValue, view, 0)
          return buffer
        },
        validate: () => {
          FlatStruct.packInto(flatValue, view, 0)
          assertEqual(FlatStruct.unpack(buffer.slice(0, FlatStruct.size)).id, flatValue.id, "packInto id")
        },
        bytesPerOperation: FlatStruct.size,
      }
    },
  ),
)

const nestedBuffer = NestedStruct.pack(nestedValue)
scenarios.push(
  packScenario({
    name: "library/nested/pack",
    description: "Pack two inline mixed-primitive structs",
    category: "nested",
    source: "library",
    tier: "extended",
    struct: NestedStruct,
    value: nestedValue,
  }),
  unpackScenario({
    name: "library/nested/unpack-only",
    description: "Unpack a prebuilt nested struct without repacking inside timing",
    category: "nested",
    source: "library",
    tier: "extended",
    struct: NestedStruct,
    buffer: nestedBuffer,
    validate: (value) => assertEqual(value.right.id, 43, "nested right id"),
  }),
)

for (const count of [0, 1, 32, 1024, 16_384]) {
  const values = sequence(count, 3)
  const buffer = PrimitiveArrayStruct.pack({ values })
  const tier: BenchmarkTier = count <= 32 ? "core" : count === 1024 ? "extended" : "stress"
  scenarios.push(
    packScenario({
      name: `library/primitive-array/pack/${count}`,
      description: `Pack a u32 pointer array with ${count} elements`,
      category: "primitive-array",
      source: "library",
      tier,
      struct: PrimitiveArrayStruct,
      value: { values },
      bytes: PrimitiveArrayStruct.size + count * 4,
      workPerOperation: Math.max(1, count),
      workLabel: "elements",
      memoryIterations: count <= 32 ? 2_000 : count === 1024 ? 100 : 10,
    }),
    unpackScenario({
      name: `library/primitive-array/unpack-only/${count}`,
      description: `Unpack a prebuilt u32 pointer array with ${count} elements`,
      category: "primitive-array",
      source: "library",
      tier,
      struct: PrimitiveArrayStruct,
      buffer,
      bytes: PrimitiveArrayStruct.size + count * 4,
      workPerOperation: Math.max(1, count),
      workLabel: "elements",
      memoryIterations: count <= 32 ? 2_000 : count === 1024 ? 100 : 10,
      validate: (output) => assertArraySample(output.values, values, `primitive array ${count}`),
    }),
  )
}

for (const count of [1, 16, 256, 4096, 16_384]) {
  const values = makeFlatList(count)
  const buffer = FlatStruct.packList(values)
  const tier: BenchmarkTier = count <= 256 ? "core" : count === 4096 ? "extended" : "stress"
  scenarios.push(
    packListScenario({
      name: `library/flat-list/pack/${count}`,
      description: `Pack ${count} flat structs into one contiguous buffer`,
      category: "list",
      source: "library",
      tier,
      struct: FlatStruct,
      values,
      bytes: FlatStruct.size * count,
      memoryIterations: count <= 16 ? 2_000 : count === 256 ? 200 : count === 4096 ? 20 : 5,
    }),
    unpackListScenario({
      name: `library/flat-list/unpack-only/${count}`,
      description: `Unpack ${count} flat structs from a prebuilt contiguous buffer`,
      category: "list",
      source: "library",
      tier,
      struct: FlatStruct,
      buffer,
      count,
      memoryIterations: count <= 16 ? 2_000 : count === 256 ? 200 : count === 4096 ? 20 : 5,
      validate: (output) => {
        assertEqual(output.length, count, "flat list count")
        assertEqual(output[count - 1]?.id, count - 1, "last flat list id")
      },
    }),
  )
}

for (const length of [16, 256, 4096]) {
  const text = `OpenTUI terminal UTF-8 🌍 `.repeat(Math.ceil(length / 28)).slice(0, length)
  const buffer = StringStruct.pack({ text })
  const tier: BenchmarkTier = length === 16 ? "core" : length === 256 ? "extended" : "stress"
  scenarios.push(
    packScenario({
      name: `library/utf8-string/pack/${length}`,
      description: `Pack a UTF-8 char* field with approximately ${length} JavaScript code units`,
      category: "strings",
      source: "library",
      tier,
      struct: StringStruct,
      value: { text },
      bytes: StringStruct.size + Buffer.byteLength(text),
      workPerOperation: Buffer.byteLength(text),
      workLabel: "UTF-8 bytes",
    }),
    unpackScenario({
      name: `library/utf8-string/unpack-only/${length}`,
      description: `Decode a prebuilt UTF-8 char* field with approximately ${length} JavaScript code units`,
      category: "strings",
      source: "library",
      tier,
      struct: StringStruct,
      buffer,
      bytes: StringStruct.size + Buffer.byteLength(text),
      workPerOperation: Buffer.byteLength(text),
      workLabel: "UTF-8 bytes",
      validate: (output) => assertEqual(output.text, text, `UTF-8 ${length}`),
    }),
  )
}

scenarios.push(
  packScenario({
    name: "library/transforms-validation/pack",
    description: "mapValue, scalar packTransform, default resolution, and validation in one pack",
    category: "options",
    source: "library",
    tier: "extended",
    struct: TransformedStruct,
    value: { raw: 21 },
    validate: (buffer) => assertEqual(new DataView(buffer).getUint32(0, true), 42, "transformed packed value"),
  }),
  unpackScenario({
    name: "library/transforms-validation/unpack-only",
    description: "unpackTransform and reduceValue from a prebuilt transformed struct",
    category: "options",
    source: "library",
    tier: "extended",
    struct: TransformedStruct,
    buffer: TransformedStruct.pack({ raw: 21 }),
    validate: (output) => assertEqual(output.total, 22, "reduced total"),
  }),
)

const enumValues = Array.from({ length: 256 }, (_, index) =>
  index % 3 === 0 ? "idle" : index % 3 === 1 ? "active" : "done",
)
const enumArrayBuffer = EnumArrayStruct.pack({ values: enumValues })
scenarios.push(
  packScenario({
    name: "library/enum-array-u8/pack/256",
    description: "Pack 256 custom-u8 enum values into a pointer array",
    category: "enum-array",
    source: "library",
    tier: "extended",
    struct: EnumArrayStruct,
    value: { values: enumValues },
    bytes: EnumArrayStruct.size + enumValues.length,
    workPerOperation: enumValues.length,
    workLabel: "enum values",
  }),
  unpackScenario({
    name: "library/enum-array-u8/unpack-only/256",
    description: "Unpack 256 custom-u8 enum values from a prebuilt pointer array",
    category: "enum-array",
    source: "library",
    tier: "extended",
    struct: EnumArrayStruct,
    buffer: enumArrayBuffer,
    bytes: EnumArrayStruct.size + enumValues.length,
    workPerOperation: enumValues.length,
    workLabel: "enum values",
    validate: (output) => {
      assertEqual(output.values.length, enumValues.length, "enum array length")
      assertEqual(Array.from(output.values)[255], enumValues[255], "last enum value")
    },
  }),
  scenario(
    "library/iterable-array/pack-set/256",
    "Materialize and pack a Set accepted by the public Iterable array input contract",
    "iterables",
    "library",
    "extended",
    () => {
      const values = new Set(sequence(256, 7))
      return {
        run: () => PrimitiveArrayStruct.pack({ values }),
        validate: () =>
          assertArraySample(
            PrimitiveArrayStruct.unpack(PrimitiveArrayStruct.pack({ values })).values,
            [...values],
            "Set values",
          ),
        workPerOperation: values.size,
        workLabel: "elements",
        bytesPerOperation: PrimitiveArrayStruct.size + values.size * 4,
        memoryIterations: 200,
      }
    },
  ),
  scenario(
    "library/alloc-struct/primitive-array/1024",
    "Allocate a struct header and preallocated 1024-element u32 payload",
    "allocation",
    "library",
    "extended",
    () => ({
      run: () => allocStruct(PrimitiveArrayStruct, { lengths: { values: 1024 } }),
      validate: () => {
        const allocation = allocStruct(PrimitiveArrayStruct, { lengths: { values: 1024 } })
        assertEqual(allocation.subBuffers?.values?.byteLength, 4096, "allocated payload bytes")
      },
      workPerOperation: 1024,
      workLabel: "elements",
      bytesPerOperation: PrimitiveArrayStruct.size + 4096,
      memoryIterations: 100,
    }),
  ),
  scenario(
    "library/schema/define-flat",
    "Compile a four-field mixed primitive schema",
    "schema-definition",
    "library",
    "extended",
    () => ({
      run: () =>
        defineStruct([
          ["id", "u32"],
          ["value", "f64"],
          ["timestamp", "u64"],
          ["active", "bool_u8"],
        ] as const),
      validate: () => {
        const definition = defineStruct([
          ["id", "u32"],
          ["value", "f64"],
          ["timestamp", "u64"],
          ["active", "bool_u8"],
        ] as const)
        assertEqual(definition.size, FlatStruct.size, "flat schema size")
      },
      workPerOperation: 4,
      workLabel: "fields",
      memoryIterations: 1_000,
    }),
  ),
  scenario(
    "library/schema/define-64-fields",
    "Stress schema compilation and layout for 64 u32 fields",
    "schema-definition",
    "library",
    "stress",
    () => {
      const fields = Array.from({ length: 64 }, (_, index) => [`field${index}`, "u32"] as const)
      return {
        run: () => defineStruct(fields as any),
        validate: () => assertEqual(defineStruct(fields as any).size, 256, "64-field schema size"),
        workPerOperation: fields.length,
        workLabel: "fields",
        memoryIterations: 100,
      }
    },
  ),
)

scenarios.push(
  scenario(
    "bun-webgpu/queue-submit/pack-object-array/1",
    "Direct packObjectArray path used for a one-command-buffer queue submission",
    "queue-submit",
    "bun-webgpu",
    "core",
    () => ({
      run: () => packObjectArray(bunWebGPUCommandBuffers),
      validate: () => {
        const packed = packObjectArray(bunWebGPUCommandBuffers)
        assertEqual(packed.byteLength, pointerSize, "queue pointer-array bytes")
        assertEqual(readPointer(packed, 0), 0x100000n, "queue command-buffer pointer")
      },
      workPerOperation: 1,
      workLabel: "command buffers",
      bytesPerOperation: pointerSize,
      memoryIterations: 20_000,
    }),
  ),
  packScenario({
    name: "bun-webgpu/bind-group-layout/pack/texture-sampler-2",
    description: "Two polymorphic bind-group-layout entries using texture and sampler inline branches",
    category: "bind-group-layout",
    source: "bun-webgpu",
    tier: "extended",
    struct: BunWebGPUBindGroupLayoutDescriptorStruct,
    value: bunWebGPUBindGroupLayoutValue,
    bytes:
      BunWebGPUBindGroupLayoutDescriptorStruct.size +
      BunWebGPUBindGroupLayoutEntryStruct.size * 2 +
      Buffer.byteLength(bunWebGPUBindGroupLayoutValue.label),
    workPerOperation: 2,
    workLabel: "bindings",
    memoryIterations: 500,
    validate: (buffer) => {
      const view = new DataView(buffer)
      assertEqual(
        view.getBigUint64(BunWebGPUBindGroupLayoutDescriptorStruct.layoutByName.get("entryCount")!.offset, true),
        2n,
        "bind-group-layout entry count",
      )
      const entriesPointer = readPointer(
        view,
        BunWebGPUBindGroupLayoutDescriptorStruct.layoutByName.get("entries")!.offset,
      )
      assert(entriesPointer !== 0n, "bind-group-layout entries pointer")
      const entriesView = new DataView(toArrayBuffer(entriesPointer, 0, BunWebGPUBindGroupLayoutEntryStruct.size * 2))
      assertEqual(
        entriesView.getUint32(BunWebGPUBindGroupLayoutEntryStruct.layoutByName.get("binding")!.offset, true),
        2,
        "texture binding",
      )
      const textureOffset = BunWebGPUBindGroupLayoutEntryStruct.layoutByName.get("texture")!.offset
      assertEqual(
        entriesView.getUint32(
          textureOffset + BunWebGPUTextureBindingLayoutStruct.layoutByName.get("sampleType")!.offset,
          true,
        ),
        2,
        "texture sample type",
      )
      const secondEntry = BunWebGPUBindGroupLayoutEntryStruct.size
      const samplerOffset = BunWebGPUBindGroupLayoutEntryStruct.layoutByName.get("sampler")!.offset
      assertEqual(
        entriesView.getUint32(
          secondEntry + samplerOffset + BunWebGPUSamplerBindingLayoutStruct.layoutByName.get("type")!.offset,
          true,
        ),
        2,
        "sampler binding type",
      )
    },
  }),
  packScenario({
    name: "bun-webgpu/render-pipeline/pack/triangle",
    description:
      "Triangle render-pipeline graph with object pointers, struct arrays, defaults, and pointer-nested fragment",
    category: "render-pipeline",
    source: "bun-webgpu",
    tier: "extended",
    struct: BunWebGPURenderPipelineDescriptorStruct,
    value: bunWebGPURenderPipelineValue,
    bytes:
      BunWebGPURenderPipelineDescriptorStruct.size +
      BunWebGPUVertexBufferLayoutStruct.size +
      BunWebGPUVertexAttributeStruct.size +
      BunWebGPUFragmentStateStruct.size +
      BunWebGPUColorTargetStateStruct.size,
    memoryIterations: 500,
    validate: (buffer) => {
      const view = new DataView(buffer)
      assertEqual(
        readPointer(view, BunWebGPURenderPipelineDescriptorStruct.layoutByName.get("layout")!.offset),
        0x100000n,
        "pipeline layout pointer",
      )
      const vertexOffset = BunWebGPURenderPipelineDescriptorStruct.layoutByName.get("vertex")!.offset
      assertEqual(
        readPointer(view, vertexOffset + BunWebGPUVertexStateStruct.layoutByName.get("module")!.offset),
        0x110000n,
        "vertex module pointer",
      )
      assertEqual(
        view.getBigUint64(vertexOffset + BunWebGPUVertexStateStruct.layoutByName.get("bufferCount")!.offset, true),
        1n,
        "vertex buffer count",
      )
      const buffersPointer = readPointer(
        view,
        vertexOffset + BunWebGPUVertexStateStruct.layoutByName.get("buffers")!.offset,
      )
      assert(buffersPointer !== 0n, "vertex buffers pointer")
      const vertexBufferView = new DataView(toArrayBuffer(buffersPointer, 0, BunWebGPUVertexBufferLayoutStruct.size))
      assertEqual(
        vertexBufferView.getBigUint64(BunWebGPUVertexBufferLayoutStruct.layoutByName.get("arrayStride")!.offset, true),
        12n,
        "vertex array stride",
      )
      const attributesPointer = readPointer(
        vertexBufferView,
        BunWebGPUVertexBufferLayoutStruct.layoutByName.get("attributes")!.offset,
      )
      assert(attributesPointer !== 0n, "vertex attributes pointer")
      const attributeView = new DataView(toArrayBuffer(attributesPointer, 0, BunWebGPUVertexAttributeStruct.size))
      assertEqual(
        attributeView.getUint32(BunWebGPUVertexAttributeStruct.layoutByName.get("format")!.offset, true),
        0x1e,
        "vertex attribute format",
      )
      const primitiveOffset = BunWebGPURenderPipelineDescriptorStruct.layoutByName.get("primitive")!.offset
      assertEqual(
        view.getUint32(primitiveOffset + BunWebGPUPrimitiveStateStruct.layoutByName.get("topology")!.offset, true),
        4,
        "primitive topology",
      )
      const fragmentPointer = readPointer(
        view,
        BunWebGPURenderPipelineDescriptorStruct.layoutByName.get("fragment")!.offset,
      )
      assert(fragmentPointer !== 0n, "fragment pointer")
      const fragmentView = new DataView(toArrayBuffer(fragmentPointer, 0, BunWebGPUFragmentStateStruct.size))
      assertEqual(
        readPointer(fragmentView, BunWebGPUFragmentStateStruct.layoutByName.get("module")!.offset),
        0x120000n,
        "fragment module pointer",
      )
      assertEqual(
        fragmentView.getBigUint64(BunWebGPUFragmentStateStruct.layoutByName.get("targetCount")!.offset, true),
        1n,
        "fragment target count",
      )
      const targetsPointer = readPointer(fragmentView, BunWebGPUFragmentStateStruct.layoutByName.get("targets")!.offset)
      assert(targetsPointer !== 0n, "fragment targets pointer")
      const targetView = new DataView(toArrayBuffer(targetsPointer, 0, BunWebGPUColorTargetStateStruct.size))
      assertEqual(
        targetView.getUint32(BunWebGPUColorTargetStateStruct.layoutByName.get("format")!.offset, true),
        0x12,
        "fragment target format",
      )
    },
  }),
  packScenario({
    name: "bun-webgpu/render-pass/pack/clear-color-1",
    description: "One render-pass color attachment with texture-view pointer and clear color",
    category: "render-pass",
    source: "bun-webgpu",
    tier: "core",
    struct: BunWebGPURenderPassDescriptorStruct,
    value: bunWebGPURenderPassValue,
    bytes: BunWebGPURenderPassDescriptorStruct.size + BunWebGPURenderPassColorAttachmentStruct.size,
    workPerOperation: 1,
    workLabel: "color attachments",
    memoryIterations: 5_000,
    validate: (buffer) => {
      const view = new DataView(buffer)
      assertEqual(
        view.getBigUint64(BunWebGPURenderPassDescriptorStruct.layoutByName.get("colorAttachmentCount")!.offset, true),
        1n,
        "render-pass attachment count",
      )
      const attachmentsPointer = readPointer(
        view,
        BunWebGPURenderPassDescriptorStruct.layoutByName.get("colorAttachments")!.offset,
      )
      assert(attachmentsPointer !== 0n, "render-pass attachments pointer")
      const attachmentView = new DataView(
        toArrayBuffer(attachmentsPointer, 0, BunWebGPURenderPassColorAttachmentStruct.size),
      )
      assertEqual(
        readPointer(attachmentView, BunWebGPURenderPassColorAttachmentStruct.layoutByName.get("view")!.offset),
        0x200000n,
        "render-pass texture-view pointer",
      )
      assertEqual(
        attachmentView.getUint32(BunWebGPURenderPassColorAttachmentStruct.layoutByName.get("loadOp")!.offset, true),
        2,
        "render-pass load op",
      )
      assertEqual(
        attachmentView.getUint32(BunWebGPURenderPassColorAttachmentStruct.layoutByName.get("storeOp")!.offset, true),
        1,
        "render-pass store op",
      )
      const clearOffset = BunWebGPURenderPassColorAttachmentStruct.layoutByName.get("clearValue")!.offset
      assertEqual(
        attachmentView.getFloat64(clearOffset + BunWebGPUColorStruct.layoutByName.get("a")!.offset, true),
        1,
        "render-pass clear alpha",
      )
    },
  }),
  scenario(
    "bun-webgpu/texture-copy/pack/texture-to-buffer-128x128",
    "Three descriptor packs used by the repeated 128x128 texture-to-buffer readback path",
    "texture-copy",
    "bun-webgpu",
    "core",
    () => {
      const packDescriptors = () => ({
        source: BunWebGPUTexelCopyTextureInfoStruct.pack(bunWebGPUTextureCopyValue.source),
        destination: BunWebGPUTexelCopyBufferInfoStruct.pack(bunWebGPUTextureCopyValue.destination),
        extent: BunWebGPUExtent3DStruct.pack(bunWebGPUTextureCopyValue.extent),
      })
      return {
        run: () => {
          BunWebGPUTexelCopyTextureInfoStruct.pack(bunWebGPUTextureCopyValue.source)
          BunWebGPUTexelCopyBufferInfoStruct.pack(bunWebGPUTextureCopyValue.destination)
          BunWebGPUExtent3DStruct.pack(bunWebGPUTextureCopyValue.extent)
        },
        runForMemory: () => packDescriptors(),
        validate: () => {
          const { source, destination, extent } = packDescriptors()
          assertEqual(
            readPointer(new DataView(source), BunWebGPUTexelCopyTextureInfoStruct.layoutByName.get("texture")!.offset),
            0x300000n,
            "copy source texture pointer",
          )
          const destinationView = new DataView(destination)
          assertEqual(
            readPointer(destinationView, BunWebGPUTexelCopyBufferInfoStruct.layoutByName.get("buffer")!.offset),
            0x310000n,
            "copy destination buffer pointer",
          )
          const layoutOffset = BunWebGPUTexelCopyBufferInfoStruct.layoutByName.get("layout")!.offset
          assertEqual(
            destinationView.getUint32(
              layoutOffset + BunWebGPUTexelCopyBufferLayoutStruct.layoutByName.get("bytesPerRow")!.offset,
              true,
            ),
            512,
            "copy bytes per row",
          )
          const extentView = new DataView(extent)
          assertEqual(
            extentView.getUint32(BunWebGPUExtent3DStruct.layoutByName.get("width")!.offset, true),
            128,
            "copy width",
          )
          assertEqual(
            extentView.getUint32(BunWebGPUExtent3DStruct.layoutByName.get("height")!.offset, true),
            128,
            "copy height",
          )
        },
        workPerOperation: 1,
        workLabel: "copy descriptor triplets",
        bytesPerOperation:
          BunWebGPUTexelCopyTextureInfoStruct.size +
          BunWebGPUTexelCopyBufferInfoStruct.size +
          BunWebGPUExtent3DStruct.size,
        memoryIterations: 5_000,
      }
    },
  ),
)

const legacySingleStructs = [
  {
    id: "simple-struct",
    oldName: "SimpleStruct",
    struct: LegacySimpleStruct,
    value: legacySimpleData,
    memoryIterations: 50_000,
    validate: (value: any) => assertEqual(value.id, 42, "legacy simple id"),
  },
  {
    id: "medium-struct",
    oldName: "MediumStruct",
    struct: LegacyMediumStruct,
    value: legacyMediumData,
    memoryIterations: 50_000,
    validate: (value: any) => assertEqual(value.score, 99.99, "legacy medium score"),
  },
  {
    id: "nested-struct",
    oldName: "NestedStruct",
    struct: LegacyNestedStruct,
    value: legacyNestedData,
    memoryIterations: 25_000,
    validate: (value: any) => assertEqual(value.status, "Active", "legacy nested status"),
  },
  {
    id: "complex-nested-struct",
    oldName: "ComplexNestedStruct",
    struct: LegacyComplexNestedStruct,
    value: legacyComplexNestedData,
    memoryIterations: 20_000,
    validate: (value: any) => assertEqual(value.footer_id, 999, "legacy complex footer id"),
  },
  {
    id: "massive-nested-struct",
    oldName: "MassiveNestedStruct",
    struct: LegacyMassiveNestedStruct,
    value: legacyMassiveNestedData,
    memoryIterations: 10_000,
    validate: (value: any) => assertEqual(value.counter, 9999999999n, "legacy massive counter"),
  },
]

for (const legacy of legacySingleStructs) {
  const buffer = legacy.struct.pack(legacy.value as any)
  scenarios.push(
    packScenario({
      name: `legacy/${legacy.id}/pack`,
      description: `Exact pre-expansion '${legacy.oldName} pack' schema and fixture`,
      category: "legacy",
      source: "legacy",
      tier: "extended",
      struct: legacy.struct,
      value: legacy.value,
      memoryIterations: legacy.memoryIterations,
    }),
    unpackScenario({
      name: `legacy/${legacy.id}/unpack-only`,
      description: `Corrected unpack-only measurement for the pre-expansion ${legacy.oldName} fixture`,
      category: "legacy",
      source: "legacy",
      tier: "extended",
      struct: legacy.struct,
      buffer,
      memoryIterations: legacy.memoryIterations,
      validate: legacy.validate,
    }),
    roundtripScenario({
      name: `legacy/${legacy.id}/roundtrip`,
      description: `Historical '${legacy.oldName} unpack' callback semantics: pack then unpack inside timing`,
      category: "legacy",
      source: "legacy",
      tier: "extended",
      struct: legacy.struct,
      value: legacy.value,
      memoryIterations: legacy.memoryIterations,
      validate: legacy.validate,
    }),
  )
}

const legacyArrayMemoryIterations = new Map([
  [10, 20_000],
  [100, 10_000],
  [1000, 1_000],
  [10_000, 100],
])
for (const [count, value] of legacyArrayData) {
  scenarios.push(
    packScenario({
      name: `legacy/array-struct/pack/${count}`,
      description: `Exact pre-expansion 'ArrayStruct pack (${count} items)' schema and fixture`,
      category: "legacy",
      source: "legacy",
      tier: "extended",
      struct: LegacyArrayStruct,
      value,
      bytes: LegacyArrayStruct.size + count * 4,
      workPerOperation: count,
      workLabel: "elements",
      memoryIterations: legacyArrayMemoryIterations.get(count),
      validate: (buffer) => assertArraySample(LegacyArrayStruct.unpack(buffer).items, value.items, "legacy array"),
    }),
  )
}

for (const [id, value, memoryIterations] of [
  ["1000-f32-500-u32", legacyLargeArrayData.medium, 1_000],
  ["10000-f32-5000-u32", legacyLargeArrayData.huge, 100],
] as const) {
  scenarios.push(
    packScenario({
      name: `legacy/large-array-struct/pack/${id}`,
      description: `Exact pre-expansion two-array LargeArrayStruct pack (${id})`,
      category: "legacy",
      source: "legacy",
      tier: "extended",
      struct: LegacyLargeArrayStruct,
      value,
      bytes: LegacyLargeArrayStruct.size + value.data.length * 4 + value.indices.length * 4,
      workPerOperation: value.data.length + value.indices.length,
      workLabel: "elements",
      memoryIterations,
      validate: (buffer) => {
        const output = LegacyLargeArrayStruct.unpack(buffer)
        assertArraySample(output.data, value.data, "legacy large data")
        assertArraySample(output.indices, value.indices, "legacy large indices")
      },
    }),
  )
}

function addLegacyListScenarios(options: {
  id: string
  oldName: string
  struct: AnyStruct
  values: any[]
  memoryIterations: number
  validate: (values: any[]) => void
}): void {
  const count = options.values.length
  const buffer = options.struct.packList(options.values)
  const bytes = options.struct.size * count
  scenarios.push(
    packListScenario({
      name: `legacy/${options.id}/pack/${count}`,
      description: `Exact pre-expansion '${options.oldName} packList (${count} items)' schema and fixture`,
      category: "legacy",
      source: "legacy",
      tier: "extended",
      struct: options.struct,
      values: options.values,
      bytes,
      memoryIterations: options.memoryIterations,
    }),
    unpackListScenario({
      name: `legacy/${options.id}/unpack-only/${count}`,
      description: `Corrected unpack-only measurement for the pre-expansion ${options.oldName} ${count}-item list`,
      category: "legacy",
      source: "legacy",
      tier: "extended",
      struct: options.struct,
      buffer,
      count,
      memoryIterations: options.memoryIterations,
      validate: options.validate,
    }),
    roundtripListScenario({
      name: `legacy/${options.id}/roundtrip/${count}`,
      description: `Historical '${options.oldName} unpackList (${count} items)' callback semantics: packList then unpackList`,
      category: "legacy",
      source: "legacy",
      tier: "extended",
      struct: options.struct,
      values: options.values,
      bytes,
      memoryIterations: options.memoryIterations,
      validate: options.validate,
    }),
  )
}

const legacySimpleListMemory = new Map([
  [10, 20_000],
  [100, 5_000],
  [1000, 500],
  [10_000, 50],
])
for (const [count, values] of legacySimpleLists) {
  addLegacyListScenarios({
    id: "simple-struct-list",
    oldName: "SimpleStruct",
    struct: LegacySimpleStruct,
    values,
    memoryIterations: legacySimpleListMemory.get(count)!,
    validate: (output) => assertEqual(output[count - 1]?.id, count - 1, "legacy simple-list last id"),
  })
}

const legacyMediumListMemory = new Map([
  [10, 20_000],
  [1000, 250],
])
for (const [count, values] of legacyMediumLists) {
  addLegacyListScenarios({
    id: "medium-struct-list",
    oldName: "MediumStruct",
    struct: LegacyMediumStruct,
    values,
    memoryIterations: legacyMediumListMemory.get(count)!,
    validate: (output) => assertEqual(output[count - 1]?.id, count - 1, "legacy medium-list last id"),
  })
}

const legacyComplexListMemory = new Map([
  [10, 5_000],
  [100, 500],
])
for (const [count, values] of legacyComplexLists) {
  addLegacyListScenarios({
    id: "complex-nested-struct-list",
    oldName: "ComplexNestedStruct",
    struct: LegacyComplexNestedStruct,
    values,
    memoryIterations: legacyComplexListMemory.get(count)!,
    validate: (output) => assertEqual(output[count - 1]?.footer_id, 999, "legacy complex-list footer id"),
  })
}

if (import.meta.main) await runBenchmarkSuite(scenarios)
