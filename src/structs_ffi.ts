import { ptr, toArrayBuffer } from "./ffi.js"
import type {
  Pointer,
  PrimitiveType,
  PointyObject,
  ObjectPointerDef,
  Simplify,
  StructObjectInputType,
  StructObjectOutputType,
  AllocStructOptions,
  AllocStructResult,
  EnumDef,
  StructFieldPackOptions,
  ArrayFieldMetadata,
  StructDef,
  StructDefOptions,
  DefineStructReturnType,
  PrimitiveToTSType,
} from "./types.js"

function fatalError(...args: any[]): never {
  const message = args.join(" ")
  console.error("FATAL ERROR:", message)
  throw new Error(message)
}

export const pointerSize = process.arch === "x64" || process.arch === "arm64" ? 8 : 4
const isBun = typeof process !== "undefined" && "bun" in process.versions

const typeSizes: Record<PrimitiveType, number> = {
  u8: 1,
  bool_u8: 1,
  bool_u32: 4,
  u16: 2,
  i16: 2,
  u32: 4,
  u64: 8,
  f32: 4,
  f64: 8,
  pointer: pointerSize,
  i32: 4,
  i64: 8,
} as const
const primitiveKeys = Object.keys(typeSizes)

function isPrimitiveType(type: any): type is PrimitiveType {
  return typeof type === "string" && primitiveKeys.includes(type)
}

const typeAlignments: Record<PrimitiveType, number> = { ...typeSizes }

const typeGetters: Record<PrimitiveType, (view: DataView, offset: number) => any> = {
  u8: (view: DataView, offset: number) => view.getUint8(offset),
  bool_u8: (view: DataView, offset: number) => Boolean(view.getUint8(offset)),
  bool_u32: (view: DataView, offset: number) => Boolean(view.getUint32(offset, true)),
  u16: (view: DataView, offset: number) => view.getUint16(offset, true),
  i16: (view: DataView, offset: number) => view.getInt16(offset, true),
  u32: (view: DataView, offset: number) => view.getUint32(offset, true),
  u64: (view: DataView, offset: number) => view.getBigUint64(offset, true),
  f32: (view: DataView, offset: number) => view.getFloat32(offset, true),
  f64: (view: DataView, offset: number) => view.getFloat64(offset, true),
  i32: (view: DataView, offset: number) => view.getInt32(offset, true),
  i64: (view: DataView, offset: number) => view.getBigInt64(offset, true),
  pointer: (view: DataView, offset: number) =>
    pointerSize === 8 ? view.getBigUint64(offset, true) : BigInt(view.getUint32(offset, true)),
}

/**
 * Type helper for creating object pointers for structs.
 */
export function objectPtr<T extends PointyObject>(): ObjectPointerDef<T> {
  return {
    __type: "objectPointer",
  }
}

function isObjectPointerDef<T extends PointyObject>(type: any): type is ObjectPointerDef<T> {
  return typeof type === "object" && type !== null && type.__type === "objectPointer"
}

export function allocStruct(structDef: StructDef<any, any>, options?: AllocStructOptions): AllocStructResult {
  const buffer = new ArrayBuffer(structDef.size)
  const view = new DataView(buffer)
  const result: AllocStructResult = { buffer, view }

  if (options?.lengths) {
    const subBuffers: Record<string, ArrayBuffer> = {}

    // Allocate sub-buffers
    for (const [arrayFieldName, length] of Object.entries(options.lengths)) {
      const arrayMeta = structDef.arrayFields.get(arrayFieldName)
      if (!arrayMeta) {
        throw new Error(`Field '${arrayFieldName}' is not an array field with a lengthOf field`)
      }

      const subBuffer = new ArrayBuffer(length * arrayMeta.elementSize)
      subBuffers[arrayFieldName] = subBuffer

      const pointer = length > 0 ? ptr(subBuffer) : null
      pointerPacker(view, arrayMeta.arrayOffset, pointer)
      retainPointerTarget(buffer, subBuffer)
      arrayMeta.lengthPack(view, arrayMeta.lengthOffset, length)
    }

    if (Object.keys(subBuffers).length > 0) {
      result.subBuffers = subBuffers
    }
  }

  return result
}

function alignOffset(offset: number, align: number): number {
  return (offset + (align - 1)) & ~(align - 1)
}

function enumTypeError(value: string): never {
  throw new TypeError(`Invalid enum value: ${value}`)
}

// Enums
export function defineEnum<T extends Record<string, number>>(
  mapping: T,
  base: Exclude<PrimitiveType, "bool_u8" | "bool_u32"> = "u32",
): EnumDef<T> {
  const reverse = Object.fromEntries(Object.entries(mapping).map(([k, v]) => [v, k]))
  return {
    __type: "enum",
    type: base,
    to(value: keyof T): number {
      return typeof value === "number" ? value : (mapping[value] ?? enumTypeError(String(value)))
    },
    from(value: number): keyof T {
      return reverse[value] ?? enumTypeError(String(value))
    },
    enum: mapping,
  }
}

function isEnum<T extends Record<string, number>>(type: any): type is EnumDef<T> {
  return typeof type === "object" && type.__type === "enum"
}

type ValidationFunction = (value: any, fieldName: string, options: { hints?: any; input?: any }) => void | never

interface StructFieldOptions {
  optional?: boolean
  // Call mapValue even if the value is undefined for inline structs.
  mapOptionalInline?: boolean
  unpackTransform?: (value: any) => any
  packTransform?: (value: any) => any
  lengthOf?: string
  asPointer?: boolean
  default?: any
  condition?: () => boolean
  validate?: ValidationFunction | ValidationFunction[]
}

type StructField =
  | readonly [string, PrimitiveType, StructFieldOptions?]
  | readonly [string, EnumDef<any>, StructFieldOptions?]
  | readonly [string, StructDef<any>, StructFieldOptions?]
  | readonly [string, "cstring" | "char*", StructFieldOptions?]
  | readonly [string, ObjectPointerDef<any>, StructFieldOptions?]
  | readonly [
      string,
      readonly [EnumDef<any> | StructDef<any> | PrimitiveType | ObjectPointerDef<any>],
      StructFieldOptions?,
    ]

interface StructLayoutField {
  name: string
  offset: number
  size: number
  align: number
  optional: boolean
  default?: any
  validate?: ValidationFunction[]
  pack: (view: DataView, offset: number, value: any, obj: any, options?: StructFieldPackOptions) => void
  unpack: (view: DataView, offset: number) => any
  unpackTransform?: (value: any) => any
  type: PrimitiveType | EnumDef<any> | StructDef<any> | "cstring" | "char*" | ObjectPointerDef<any> | readonly [any]
  lengthOf?: string
}

interface PlainPrimitiveField {
  name: string
  offset: number
  type: Exclude<PrimitiveType, "pointer">
}

interface PrimitiveDecodeField {
  name: string
  offset: number
  type: PrimitiveType
}

function hasPlainPrimitiveRuntimeOptions(options: StructFieldOptions): boolean {
  return (
    options.optional === true ||
    options.unpackTransform !== undefined ||
    options.packTransform !== undefined ||
    options.lengthOf !== undefined ||
    options.default !== undefined ||
    options.validate !== undefined
  )
}

function isStruct(type: any): type is StructDef<any> {
  return typeof type === "object" && type.__type === "struct"
}

interface StructInternals {
  layout: StructLayoutField[]
  options?: StructDefOptions
  publicPack: StructDef<any, any>["pack"]
  publicUnpack: StructDef<any, any>["unpack"]
  hasDirectInlinePack: boolean
  directInlineUnpackSafe: boolean
  materializeArrayIterables: ((obj: any) => any) | null
}

const structInternals = new WeakMap<StructDef<any, any>, StructInternals>()
const freshPackBuffers = new WeakSet<ArrayBufferLike>()

function packInlineStruct(
  internals: StructInternals,
  view: DataView,
  baseOffset: number,
  obj: any,
  options?: StructFieldPackOptions,
): void {
  let mappedObj = internals.options?.mapValue ? internals.options.mapValue(obj) : obj
  if (internals.materializeArrayIterables) mappedObj = internals.materializeArrayIterables(mappedObj)

  for (const field of internals.layout) {
    const value = mappedObj[field.name] ?? field.default
    if (!field.optional && value === undefined) {
      fatalError(`Packing non-optional field '${field.name}' but value is undefined (and no default provided)`)
    }
    if (field.validate) {
      for (const validateFn of field.validate) {
        validateFn(value, field.name, {
          hints: options?.validationHints,
          input: mappedObj,
        })
      }
    }
    field.pack(view, baseOffset + field.offset, value, mappedObj, options)
  }
}

function unpackInlineStruct(internals: StructInternals, view: DataView, baseOffset: number): any {
  const result: any = internals.options?.default ? { ...internals.options.default } : {}

  for (const field of internals.layout) {
    if (!field.unpack) continue

    try {
      result[field.name] = field.unpack(view, baseOffset + field.offset)
    } catch (error) {
      console.error(`Error unpacking field '${field.name}' at offset ${field.offset}:`, error)
      throw error
    }
  }

  return internals.options?.reduceValue ? internals.options.reduceValue(result) : result
}

function primitivePackers(type: PrimitiveType) {
  let pack: (view: DataView, off: number, val: any) => void
  let unpack: (view: DataView, off: number) => any

  switch (type) {
    case "u8":
      pack = (view: DataView, off: number, val: number) => view.setUint8(off, val)
      unpack = (view: DataView, off: number) => view.getUint8(off)
      break
    case "bool_u8":
      pack = (view: DataView, off: number, val: boolean) => view.setUint8(off, !!val ? 1 : 0)
      unpack = (view: DataView, off: number) => Boolean(view.getUint8(off))
      break
    case "bool_u32":
      pack = (view: DataView, off: number, val: boolean) => view.setUint32(off, !!val ? 1 : 0, true)
      unpack = (view: DataView, off: number) => Boolean(view.getUint32(off, true))
      break
    case "u16":
      pack = (view: DataView, off: number, val: number) => view.setUint16(off, val, true)
      unpack = (view: DataView, off: number) => view.getUint16(off, true)
      break
    case "i16":
      pack = (view: DataView, off: number, val: number) => view.setInt16(off, val, true)
      unpack = (view: DataView, off: number) => view.getInt16(off, true)
      break
    case "u32":
      pack = (view: DataView, off: number, val: number) => view.setUint32(off, val, true)
      unpack = (view: DataView, off: number) => view.getUint32(off, true)
      break
    case "i32":
      pack = (view: DataView, off: number, val: number) => view.setInt32(off, val, true)
      unpack = (view: DataView, off: number) => view.getInt32(off, true)
      break
    case "i64":
      pack = (view: DataView, off: number, val: bigint) => view.setBigInt64(off, BigInt(val), true)
      unpack = (view: DataView, off: number) => view.getBigInt64(off, true)
      break
    case "u64":
      pack = (view: DataView, off: number, val: bigint) => view.setBigUint64(off, BigInt(val), true)
      unpack = (view: DataView, off: number) => view.getBigUint64(off, true)
      break
    case "f32":
      pack = (view: DataView, off: number, val: number) => view.setFloat32(off, val, true)
      unpack = (view: DataView, off: number) => view.getFloat32(off, true)
      break
    case "f64":
      pack = (view: DataView, off: number, val: number) => view.setFloat64(off, val, true)
      unpack = (view: DataView, off: number) => view.getFloat64(off, true)
      break
    case "pointer":
      if (pointerSize === 8 && isBun) {
        pack = (view: DataView, off: number, val: Pointer) => {
          if (!val) {
            view.setUint32(off, 0, true)
            view.setUint32(off + 4, 0, true)
          } else if (typeof val === "number" && Number.isInteger(val)) {
            view.setUint32(off, val, true)
            view.setUint32(off + 4, Math.floor(val / 0x100000000), true)
          } else {
            view.setBigUint64(off, BigInt(val), true)
          }
        }
        unpack = (view: DataView, off: number): Pointer =>
          view.getUint32(off, true) + view.getUint32(off + 4, true) * 0x100000000
      } else {
        pack = (view: DataView, off: number, val: Pointer) => {
          pointerSize === 8
            ? view.setBigUint64(off, val ? BigInt(val) : 0n, true)
            : view.setUint32(off, val ? Number(val) : 0, true)
        }
        unpack = (view: DataView, off: number): Pointer => {
          if (pointerSize === 8) {
            const value = view.getBigUint64(off, true)
            return isBun ? Number(value) : value
          }

          return view.getUint32(off, true)
        }
      }
      break
    default:
      // This should be caught by PrimitiveType, but belts and suspenders
      fatalError(`Unsupported primitive type: ${type}`)
  }

  return { pack, unpack }
}

function primitiveSetterSource(type: PlainPrimitiveField["type"], offset: number, value: string): string {
  const target = `baseOffset + ${offset}`
  switch (type) {
    case "u8":
      return `view.setUint8(${target}, ${value})`
    case "bool_u8":
      return `view.setUint8(${target}, ${value} ? 1 : 0)`
    case "bool_u32":
      return `view.setUint32(${target}, ${value} ? 1 : 0, true)`
    case "u16":
      return `view.setUint16(${target}, ${value}, true)`
    case "i16":
      return `view.setInt16(${target}, ${value}, true)`
    case "u32":
      return `view.setUint32(${target}, ${value}, true)`
    case "i32":
      return `view.setInt32(${target}, ${value}, true)`
    case "i64":
      return `view.setBigInt64(${target}, BigInt(${value}), true)`
    case "u64":
      return `view.setBigUint64(${target}, BigInt(${value}), true)`
    case "f32":
      return `view.setFloat32(${target}, ${value}, true)`
    case "f64":
      return `view.setFloat64(${target}, ${value}, true)`
  }
}

function primitiveGetterSource(type: PrimitiveType, offset: number): string {
  const target = `baseOffset + ${offset}`
  switch (type) {
    case "u8":
      return `view.getUint8(${target})`
    case "bool_u8":
      return `Boolean(view.getUint8(${target}))`
    case "bool_u32":
      return `Boolean(view.getUint32(${target}, true))`
    case "u16":
      return `view.getUint16(${target}, true)`
    case "i16":
      return `view.getInt16(${target}, true)`
    case "u32":
      return `view.getUint32(${target}, true)`
    case "i32":
      return `view.getInt32(${target}, true)`
    case "i64":
      return `view.getBigInt64(${target}, true)`
    case "u64":
      return `view.getBigUint64(${target}, true)`
    case "f32":
      return `view.getFloat32(${target}, true)`
    case "f64":
      return `view.getFloat64(${target}, true)`
    case "pointer":
      if (pointerSize === 8 && isBun) {
        return `view.getUint32(${target}, true) + view.getUint32(${target} + 4, true) * 0x100000000`
      }
      return pointerSize === 8 ? `view.getBigUint64(${target}, true)` : `view.getUint32(${target}, true)`
  }
}

function compilePlainPrimitivePackList(fields: PlainPrimitiveField[], totalSize: number) {
  const writes = fields
    .map((field, index) => {
      const value = `value${index}`
      const missing = `Packing non-optional field '${field.name}' at index `
      return `
        const ${value} = obj[${JSON.stringify(field.name)}] ?? undefined
        if (${value} === undefined) fatalError(${JSON.stringify(missing)} + index + ${JSON.stringify(
          " but value is undefined (and no default provided)",
        )})
        ${primitiveSetterSource(field.type, field.offset, value)}
      `
    })
    .join("\n")

  return new Function(
    "fatalError",
    `return function packPlainPrimitiveList(objects) {
      const buffer = new ArrayBuffer(${totalSize} * objects.length)
      const view = new DataView(buffer)
      for (let index = 0, baseOffset = 0; index < objects.length; index++, baseOffset += ${totalSize}) {
        const obj = objects[index]
        ${writes}
      }
      return buffer
    }`,
  )(fatalError) as (objects: any[]) => ArrayBuffer
}

function compilePlainPrimitivePack(fields: PlainPrimitiveField[], totalSize: number) {
  const writes = fields
    .map((field, index) => {
      const value = `value${index}`
      return `
        const ${value} = obj[${JSON.stringify(field.name)}] ?? undefined
        if (${value} === undefined) fatalError(${JSON.stringify(
          `Packing non-optional field '${field.name}' but value is undefined (and no default provided)`,
        )})
        ${primitiveSetterSource(field.type, field.offset, value)}
      `
    })
    .join("\n")

  return new Function(
    "fatalError",
    `return function packPlainPrimitive(obj) {
      const buffer = new ArrayBuffer(${totalSize})
      const view = new DataView(buffer)
      let baseOffset = 0
      ${writes}
      return buffer
    }`,
  )(fatalError) as (obj: any) => ArrayBuffer
}

function compilePlainPrimitivePackInto(fields: PlainPrimitiveField[]) {
  const writes = fields
    .map((field, index) => {
      const value = `value${index}`
      return `
        const ${value} = obj[${JSON.stringify(field.name)}] ?? undefined
        if (${value} === undefined) {
          console.warn(${JSON.stringify(`packInto missing value for non-optional field '${field.name}' at offset `)} + (baseOffset + ${field.offset}) + ${JSON.stringify(". Writing default or zero.")})
        }
        ${primitiveSetterSource(field.type, field.offset, value)}
      `
    })
    .join("\n")

  return new Function(
    `return function packPlainPrimitiveInto(obj, view, baseOffset) {
      ${writes}
    }`,
  )() as (obj: any, view: DataView, offset: number) => void
}

function compilePlainPrimitivePackListInto(fields: PlainPrimitiveField[], totalSize: number) {
  const writes = fields
    .map((field, index) => {
      const value = `value${index}`
      return `
        const ${value} = obj[${JSON.stringify(field.name)}] ?? undefined
        if (${value} === undefined) {
          console.warn(${JSON.stringify(`packInto missing value for non-optional field '${field.name}' at offset `)} + (baseOffset + ${field.offset}) + ${JSON.stringify(". Writing default or zero.")})
        }
        ${primitiveSetterSource(field.type, field.offset, value)}
      `
    })
    .join("\n")

  return new Function(
    `return function packPlainPrimitiveListInto(objects, view, initialOffset) {
      for (let index = 0, baseOffset = initialOffset; index < objects.length; index++, baseOffset += ${totalSize}) {
        const obj = objects[index]
        ${writes}
      }
    }`,
  )() as (objects: any[], view: DataView, offset: number) => void
}

function compilePlainPrimitiveUnpackList(fields: PlainPrimitiveField[], totalSize: number) {
  const reads = fields
    .map(
      (field, index) => `
        let value${index}
        try {
          value${index} = ${primitiveGetterSource(field.type, field.offset)}
        } catch (error) {
          console.error(${JSON.stringify(`Error unpacking field '${field.name}' at index `)} + index + ${JSON.stringify(
            ", offset ",
          )} + (baseOffset + ${field.offset}) + ":", error)
          throw error
        }
      `,
    )
    .join("\n")
  const properties = fields.map((field, index) => `${JSON.stringify(field.name)}: value${index}`).join(",")

  return new Function(
    `return function unpackPlainPrimitiveList(view, count) {
      const preallocated = Number.isSafeInteger(count) && count >= ${arrayPreallocationThreshold} && count <= ${maxArrayLength}
      const results = preallocated ? new Array(count) : []
      for (let index = 0, baseOffset = 0; index < count; index++, baseOffset += ${totalSize}) {
        ${reads}
        const value = { ${properties} }
        if (preallocated) results[index] = value
        else results.push(value)
      }
      return results
    }`,
  )() as (view: DataView, count: number) => any[]
}

function compileReducedPrimitiveUnpackList(
  fields: PrimitiveDecodeField[],
  totalSize: number,
  options: StructDefOptions,
) {
  const reads = fields
    .map(
      (field, index) => `
        let value${index}
        try {
          value${index} = ${primitiveGetterSource(field.type, field.offset)}
        } catch (error) {
          console.error(${JSON.stringify(`Error unpacking field '${field.name}' at index `)} + index + ${JSON.stringify(
            ", offset ",
          )} + (baseOffset + ${field.offset}) + ":", error)
          throw error
        }
      `,
    )
    .join("\n")
  const properties = fields.map((field, index) => `${JSON.stringify(field.name)}: value${index}`).join(",")

  return new Function(
    "options",
    `return function unpackReducedPrimitiveList(view, count) {
      const preallocated = Number.isSafeInteger(count) && count >= ${arrayPreallocationThreshold} && count <= ${maxArrayLength}
      const results = preallocated ? new Array(count) : []
      for (let index = 0, baseOffset = 0; index < count; index++, baseOffset += ${totalSize}) {
        ${reads}
        const raw = { ${properties} }
        const value = options.reduceValue ? options.reduceValue(raw) : raw
        if (preallocated) results[index] = value
        else results.push(value)
      }
      return results
    }`,
  )(options) as (view: DataView, count: number) => any[]
}

function compilePlainPrimitiveUnpack(fields: PlainPrimitiveField[]) {
  const reads = fields
    .map(
      (field, index) => `
        let value${index}
        try {
          value${index} = ${primitiveGetterSource(field.type, field.offset)}
        } catch (error) {
          console.error(${JSON.stringify(`Error unpacking field '${field.name}' at offset ${field.offset}:`)}, error)
          throw error
        }
      `,
    )
    .join("\n")
  const properties = fields.map((field, index) => `${JSON.stringify(field.name)}: value${index}`).join(",")

  return new Function(
    `return function unpackPlainPrimitive(view) {
      let baseOffset = 0
      ${reads}
      return { ${properties} }
    }`,
  )() as (view: DataView) => any
}

function compilePlainPrimitiveUnpackInto(fields: PlainPrimitiveField[]) {
  const reads = fields
    .map(
      (field) => `
        try {
          target[${JSON.stringify(field.name)}] = ${primitiveGetterSource(field.type, field.offset)}
        } catch (error) {
          console.error(${JSON.stringify(`Error unpacking field '${field.name}' at offset ${field.offset}:`)}, error)
          throw error
        }
      `,
    )
    .join("\n")

  return new Function(
    `return function unpackPlainPrimitiveInto(view, target, baseOffset) {
      ${reads}
      return target
    }`,
  )() as (view: DataView, target: any, baseOffset: number) => any
}

const { pack: pointerPacker, unpack: pointerUnpacker } = primitivePackers("pointer")
const foreignMemoryPointerUnpacker =
  pointerSize === 8 && isBun
    ? (view: DataView, off: number): Pointer => Number(view.getBigUint64(off, true))
    : pointerUnpacker

const retainedPointerTargets = new WeakMap<ArrayBufferLike, unknown[]>()

function retainPointerTarget(owner: ArrayBufferLike, target: unknown) {
  const retained = retainedPointerTargets.get(owner)
  if (retained) {
    retained.push(target)
  } else {
    retainedPointerTargets.set(owner, [target])
  }
}

function retainIfPointerTargets(owner: ArrayBufferLike, target: ArrayBufferLike) {
  if (retainedPointerTargets.has(target)) retainPointerTarget(owner, target)
}

function isNullPointer(pointer: Pointer | null | undefined): boolean {
  return pointer == null || pointer === 0 || pointer === 0n
}

function toItemCount(length: number | bigint): number {
  return typeof length === "bigint" ? Number(length) : length
}

const arrayPreallocationThreshold = 256
// Delay generated kernels until repeated small calls or one large call can amortize compilation.
const plainPrimitiveSpecializationThreshold = 256
const maxArrayLength = 0xffffffff

export function packObjectArray(val: (PointyObject | null)[]) {
  const buffer = new ArrayBuffer(val.length * pointerSize)
  const bufferView = new DataView(buffer)
  for (let i = 0; i < val.length; i++) {
    const instance = val[i]
    const ptrValue = instance?.ptr ?? null
    pointerPacker(bufferView, i * pointerSize, ptrValue)
  }
  return bufferView
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Define Struct
export function defineStruct<const Fields extends readonly StructField[], const Opts extends StructDefOptions = {}>(
  fields: Fields & StructField[],
  structDefOptions?: Opts,
): DefineStructReturnType<Fields, Opts> {
  let offset = 0
  let maxAlign = 1
  let hasDirectInlinePack = false
  let directInlineUnpackSafe = !structDefOptions?.default && !structDefOptions?.reduceValue
  let plainPrimitiveFields: PlainPrimitiveField[] | null =
    structDefOptions?.mapValue || structDefOptions?.default || structDefOptions?.reduceValue ? null : []
  let primitiveDecodeFields: PrimitiveDecodeField[] | null =
    structDefOptions?.reduceValue && !structDefOptions.default ? [] : null
  const layout: StructLayoutField[] = []
  const lengthOfFields: Record<string, StructLayoutField> = {}
  const lengthOfRequested: {
    requester: StructLayoutField
    def: EnumDef<any> | PrimitiveType | "char*"
  }[] = []
  const arrayFieldsMetadata: Record<string, ArrayFieldMetadata> = {}
  const arrayElementSizes: Record<string, number> = {}

  for (const [name, typeOrStruct, options = {}] of fields) {
    if (options.condition && !options.condition()) {
      continue
    }

    let size = 0,
      align = 0
    let pack: (view: DataView, offset: number, value: any, obj: any, options?: StructFieldPackOptions) => void
    let unpack: (view: DataView, offset: number) => any
    let needsLengthOf = false
    let lengthOfDef: EnumDef<any> | PrimitiveType | null = null
    let plainPrimitiveType: PlainPrimitiveField["type"] | null = null

    // Primitive
    if (isPrimitiveType(typeOrStruct)) {
      size = typeSizes[typeOrStruct]
      align = typeAlignments[typeOrStruct]
      ;({ pack, unpack } = primitivePackers(typeOrStruct))

      if (typeOrStruct === "pointer") {
        // Pointer fields borrow JavaScript memory: when the packed value (possibly
        // produced by a packTransform) is a buffer or view, serialize its address
        // and retain the source with the packed struct so the address stays valid
        // for as long as the struct buffer is alive. Raw addresses pack unchanged;
        // their owners must be retained by the caller.
        pack = (view: DataView, off: number, val: any) => {
          if (val instanceof ArrayBuffer || ArrayBuffer.isView(val)) {
            if (val.byteLength === 0) {
              pointerPacker(view, off, null)
              return
            }

            pointerPacker(view, off, ptr(val))
            retainPointerTarget(view.buffer, val)
            return
          }

          pointerPacker(view, off, val)
        }
      }

      if (plainPrimitiveFields) {
        if (typeOrStruct === "pointer" || hasPlainPrimitiveRuntimeOptions(options)) plainPrimitiveFields = null
        else plainPrimitiveType = typeOrStruct
      }
      // CString (null-terminated)
    } else if (typeof typeOrStruct === "string" && typeOrStruct === "cstring") {
      plainPrimitiveFields = null
      size = pointerSize
      align = pointerSize
      pack = (view: DataView, off: number, val: string | null) => {
        if (!val) {
          pointerPacker(view, off, null)
          return
        }

        const bytes = encoder.encode(val + "\0")
        const bufPtr = ptr(bytes)
        pointerPacker(view, off, bufPtr)
        retainPointerTarget(view.buffer, bytes)
      }
      unpack = (view: DataView, off: number) => {
        // TODO: Unpack CString from pointer
        const ptrVal = pointerUnpacker(view, off)
        return ptrVal // Returning pointer for now
      }
      // char* (raw string pointer, length usually external)
    } else if (typeof typeOrStruct === "string" && typeOrStruct === "char*") {
      plainPrimitiveFields = null
      size = pointerSize
      align = pointerSize
      pack = (view: DataView, off: number, val: string | null) => {
        if (!val) {
          pointerPacker(view, off, null)
          return
        }

        const bytes = encoder.encode(val) // No null terminator
        const bufPtr = ptr(bytes)
        pointerPacker(view, off, bufPtr)
        retainPointerTarget(view.buffer, bytes)
      }
      // Initial unpack returns pointer; will be replaced if lengthOf field exists
      unpack = (view: DataView, off: number) => {
        const ptrVal = pointerUnpacker(view, off)
        return ptrVal
      }
      needsLengthOf = true // Mark for later resolution
      // Enum
    } else if (isEnum(typeOrStruct)) {
      plainPrimitiveFields = null
      directInlineUnpackSafe = false
      const base = typeOrStruct.type
      size = typeSizes[base]
      align = typeAlignments[base]
      const { pack: packEnum } = primitivePackers(base)
      pack = (view, off, val) => {
        const num = typeOrStruct.to(val)
        packEnum(view, off, num)
      }
      unpack = (view, off) => {
        const raw = typeGetters[base](view, off)
        return typeOrStruct.from(raw)
      }
      // Struct
    } else if (isStruct(typeOrStruct)) {
      plainPrimitiveFields = null
      if (options.asPointer === true) {
        directInlineUnpackSafe = false
        size = pointerSize
        align = pointerSize
        pack = (view, off, val, obj, options) => {
          if (!val) {
            pointerPacker(view, off, null)
            return
          }
          const nestedBuf = typeOrStruct.pack(val, options)
          pointerPacker(view, off, ptr(nestedBuf))
          retainPointerTarget(view.buffer, nestedBuf)
        }
        unpack = (view, off) => {
          throw new Error("Not implemented yet")
        }
      } else {
        // Inline struct
        size = typeOrStruct.size
        align = typeOrStruct.align
        const internals = structInternals.get(typeOrStruct)
        directInlineUnpackSafe &&= !!internals?.directInlineUnpackSafe
        hasDirectInlinePack ||= !!internals && !options.optional
        pack = (view, off, val, obj, packOptions) => {
          const publicPack = typeOrStruct.pack
          if (internals && freshPackBuffers.has(view.buffer) && publicPack === internals.publicPack) {
            packInlineStruct(internals, view, off, val, packOptions)
            return
          }

          const nestedBuf = Reflect.apply(publicPack, typeOrStruct, [val, packOptions])
          const nestedView = new Uint8Array(nestedBuf)
          const dView = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
          dView.set(nestedView, off)
          retainIfPointerTargets(view.buffer, nestedBuf)
        }
        unpack = (view, off) => {
          const publicUnpack = Object.getOwnPropertyDescriptor(typeOrStruct, "unpack")?.value
          if (
            internals?.directInlineUnpackSafe &&
            publicUnpack === internals.publicUnpack &&
            !(view.buffer instanceof SharedArrayBuffer)
          ) {
            return unpackInlineStruct(internals, view, off)
          }

          const start = view.byteOffset + off
          const slice = view.buffer.slice(start, start + size)
          return typeOrStruct.unpack(slice)
        }
      }
      // Object Pointer
    } else if (isObjectPointerDef(typeOrStruct)) {
      plainPrimitiveFields = null
      size = pointerSize
      align = pointerSize

      pack = (view, off, value: PointyObject | null) => {
        const ptrValue = value?.ptr ?? null
        // @ts-ignore
        if (ptrValue === undefined) {
          console.warn(
            `Field '${name}' expected object with '.ptr' property, but got undefined pointer value from:`,
            value,
          )
          pointerPacker(view, off, null) // Pack null if pointer is missing
        } else {
          pointerPacker(view, off, ptrValue)
        }
      }
      // Unpacking returns the raw pointer value, not the class instance
      // TODO: objectPtr could take a reconstructor function to reconstruct the object from the pointer
      unpack = (view, off) => {
        return pointerUnpacker(view, off)
      }

      // Array ([EnumType], [StructType], [PrimitiveType], ...)
    } else if (Array.isArray(typeOrStruct) && typeOrStruct.length === 1 && typeOrStruct[0] !== undefined) {
      plainPrimitiveFields = null
      const [def] = typeOrStruct
      size = pointerSize // Arrays are always represented by a pointer to the data
      align = pointerSize
      let arrayElementSize: number

      if (isEnum(def)) {
        directInlineUnpackSafe = false
        // Packing an array of enums
        arrayElementSize = typeSizes[def.type]
        const { pack: enumPack } = primitivePackers(def.type)
        pack = (view, off, val: string[], obj) => {
          if (!val || val.length === 0) {
            pointerPacker(view, off, null)
            return
          }
          const buffer = new ArrayBuffer(val.length * arrayElementSize)
          const bufferView = new DataView(buffer)
          for (let i = 0; i < val.length; i++) {
            const num = def.to(val[i]!)
            enumPack(bufferView, i * arrayElementSize, num)
          }
          pointerPacker(view, off, ptr(buffer))
          retainPointerTarget(view.buffer, buffer)
        }
        unpack = null!
        needsLengthOf = true
        lengthOfDef = def
      } else if (isStruct(def)) {
        directInlineUnpackSafe = false
        // Array of Structs
        arrayElementSize = def.size
        const defInternals = structInternals.get(def)
        pack = (view, off, val: any[], obj, options) => {
          if (!val || val.length === 0) {
            pointerPacker(view, off, null)
            return
          }
          const buffer = new ArrayBuffer(val.length * arrayElementSize)
          const bufferView = new DataView(buffer)
          if (defInternals?.hasDirectInlinePack) {
            freshPackBuffers.add(buffer)
            try {
              for (let i = 0; i < val.length; i++) {
                def.packInto(val[i], bufferView, i * arrayElementSize, options)
              }
            } finally {
              freshPackBuffers.delete(buffer)
            }
          } else {
            for (let i = 0; i < val.length; i++) {
              def.packInto(val[i], bufferView, i * arrayElementSize, options)
            }
          }
          pointerPacker(view, off, ptr(buffer))
          retainPointerTarget(view.buffer, buffer)
        }
        unpack = (view, off) => {
          throw new Error("Not implemented yet")
        }
      } else if (isPrimitiveType(def)) {
        // Array of Primitives
        arrayElementSize = typeSizes[def]
        const { pack: primitivePack } = primitivePackers(def)
        // Ensure 'val' type matches the expected primitive array type
        pack = (view, off, val: PrimitiveToTSType<typeof def>[]) => {
          if (!val || val.length === 0) {
            pointerPacker(view, off, null)
            return
          }
          const buffer = new ArrayBuffer(val.length * arrayElementSize)
          const bufferView = new DataView(buffer)
          for (let i = 0; i < val.length; i++) {
            primitivePack(bufferView, i * arrayElementSize, val[i])
          }
          pointerPacker(view, off, ptr(buffer))
          retainPointerTarget(view.buffer, buffer)
        }
        unpack = null!
        needsLengthOf = true
        lengthOfDef = def
      } else if (isObjectPointerDef(def)) {
        directInlineUnpackSafe = false
        arrayElementSize = pointerSize
        pack = (view, off, val) => {
          if (!val || val.length === 0) {
            pointerPacker(view, off, null)
            return
          }

          const packedView = packObjectArray(val)
          pointerPacker(view, off, ptr(packedView.buffer))
          retainPointerTarget(view.buffer, packedView.buffer)
        }
        unpack = () => {
          // TODO: implement unpack for class pointers
          throw new Error("not implemented yet")
        }
      } else {
        throw new Error(`Unsupported array element type for ${name}: ${JSON.stringify(def)}`)
      }
      arrayElementSizes[name] = arrayElementSize
    } else {
      throw new Error(`Unsupported field type for ${name}: ${JSON.stringify(typeOrStruct)}`)
    }

    offset = alignOffset(offset, align)
    if (plainPrimitiveFields && plainPrimitiveType) {
      plainPrimitiveFields.push({ name, offset, type: plainPrimitiveType })
    }
    if (primitiveDecodeFields) {
      if (isPrimitiveType(typeOrStruct) && !options.unpackTransform) {
        primitiveDecodeFields.push({ name, offset, type: typeOrStruct })
      } else {
        primitiveDecodeFields = null
      }
    }

    if (options.unpackTransform) {
      directInlineUnpackSafe = false
      const originalUnpack = unpack
      unpack = (view, off) => options.unpackTransform!(originalUnpack(view, off))
    }
    if (options.packTransform) {
      const originalPack = pack
      pack = (view, off, val, obj, packOptions) =>
        originalPack(view, off, options.packTransform!(val), obj, packOptions)
    }
    if (options.optional) {
      const originalPack = pack
      if (isStruct(typeOrStruct) && !options.asPointer) {
        pack = (view, off, val, obj, packOptions) => {
          // Given mapOptionalInline, we execute the pack even if the value is undefined,
          // as the mapValue function can handle undefined values if needed.
          if (val || options.mapOptionalInline) {
            originalPack(view, off, val, obj, packOptions)
          }
        }
      } else {
        pack = (view, off, val, obj, packOptions) => originalPack(view, off, val ?? 0, obj, packOptions)
      }
    }
    if (options.lengthOf) {
      const originalPack = pack
      pack = (view, off, val, obj, packOptions) => {
        const targetValue = obj[options.lengthOf!]
        let length = 0
        if (targetValue) {
          if (typeof targetValue === "string") {
            length = Buffer.byteLength(targetValue)
          } else {
            length = targetValue.length
          }
        }
        return originalPack(view, off, length, obj, packOptions)
      }
    }

    // Normalize validation to always be an array
    let validateFunctions: ValidationFunction[] | undefined
    if (options.validate) {
      validateFunctions = Array.isArray(options.validate) ? options.validate : [options.validate]
    }

    // LAYOUT FIELD
    const layoutField: StructLayoutField = {
      name,
      offset,
      size,
      align,
      validate: validateFunctions,
      optional: !!options.optional || !!options.lengthOf || options.default !== undefined,
      default: options.default,
      pack,
      unpack,
      unpackTransform: options.unpackTransform,
      type: typeOrStruct,
      lengthOf: options.lengthOf,
    }
    layout.push(layoutField)

    if (options.lengthOf) {
      lengthOfFields[options.lengthOf] = layoutField
    }
    if (needsLengthOf) {
      // For char*, pass "char*" as the def; for arrays, pass the actual def
      const def = typeof typeOrStruct === "string" && typeOrStruct === "char*" ? "char*" : lengthOfDef
      if (!def) fatalError(`Internal error: needsLengthOf=true but def is null for ${name}`)
      lengthOfRequested.push({ requester: layoutField, def })
    }

    offset += size
    maxAlign = Math.max(maxAlign, align)
  }

  // Resolve allocation metadata after layout so field declaration order does not matter.
  for (const [arrayName, lengthOfField] of Object.entries(lengthOfFields)) {
    const arrayField = layout.find((field) => field.name === arrayName)
    const elementSize = arrayElementSizes[arrayName]
    if (!arrayField || elementSize === undefined || !isPrimitiveType(lengthOfField.type)) continue

    const { pack: lengthPack } = primitivePackers(lengthOfField.type)
    arrayFieldsMetadata[arrayName] = {
      elementSize,
      arrayOffset: arrayField.offset,
      lengthOffset: lengthOfField.offset,
      lengthPack,
    }
  }

  // Resolve lengthOf fields
  for (const { requester, def } of lengthOfRequested) {
    const lengthOfField = lengthOfFields[requester.name]

    if (!lengthOfField) {
      if (def === "char*") {
        continue
      }
      throw new Error(`lengthOf field not found for array field ${requester.name}`)
    }

    if (def === "char*") {
      const relativeOffset = lengthOfField.offset - requester.offset

      requester.unpack = (view, off) => {
        const ptrAddress = foreignMemoryPointerUnpacker(view, off)
        const length = lengthOfField.unpack(view, off + relativeOffset)

        if (isNullPointer(ptrAddress)) {
          return null
        }

        const byteLength = toItemCount(length)

        if (byteLength === 0) {
          return ""
        }

        const buffer = toArrayBuffer(ptrAddress, 0, byteLength)
        return decoder.decode(buffer)
      }
    } else if (isPrimitiveType(def)) {
      const elemSize = typeSizes[def]
      const { unpack: primitiveUnpack } = primitivePackers(def)
      const relativeOffset = lengthOfField.offset - requester.offset

      requester.unpack = (view, off) => {
        const length = lengthOfField.unpack(view, off + relativeOffset)
        const itemCount = toItemCount(length)
        const ptrAddress = foreignMemoryPointerUnpacker(view, off)

        if (isNullPointer(ptrAddress) && itemCount > 0) {
          throw new Error(`Array field ${requester.name} has null pointer but length ${length}.`)
        }
        if (isNullPointer(ptrAddress) || itemCount === 0) {
          return []
        }

        const buffer = toArrayBuffer(ptrAddress, 0, itemCount * elemSize)
        const bufferView = new DataView(buffer)

        if (
          Number.isSafeInteger(itemCount) &&
          itemCount >= arrayPreallocationThreshold &&
          itemCount <= maxArrayLength
        ) {
          const result = new Array(itemCount)
          for (let i = 0; i < itemCount; i++) {
            result[i] = primitiveUnpack(bufferView, i * elemSize)
          }
          return result
        }

        const result = []
        for (let i = 0; i < itemCount; i++) result.push(primitiveUnpack(bufferView, i * elemSize))
        return result
      }
    } else {
      const elemSize = typeSizes[def.type]
      const { unpack: enumUnpack } = primitivePackers(def.type)
      const relativeOffset = lengthOfField.offset - requester.offset

      requester.unpack = (view, off) => {
        const length = lengthOfField.unpack(view, off + relativeOffset)
        const itemCount = toItemCount(length)
        const ptrAddress = foreignMemoryPointerUnpacker(view, off)

        if (isNullPointer(ptrAddress) && itemCount > 0) {
          throw new Error(`Array field ${requester.name} has null pointer but length ${length}.`)
        }
        if (isNullPointer(ptrAddress) || itemCount === 0) {
          return []
        }

        const buffer = toArrayBuffer(ptrAddress, 0, itemCount * elemSize)
        const bufferView = new DataView(buffer)

        if (
          Number.isSafeInteger(itemCount) &&
          itemCount >= arrayPreallocationThreshold &&
          itemCount <= maxArrayLength
        ) {
          const result = new Array(itemCount)
          for (let i = 0; i < itemCount; i++) {
            result[i] = def.from(enumUnpack(bufferView, i * elemSize))
          }
          return result
        }

        const result = []
        for (let i = 0; i < itemCount; i++) result.push(def.from(enumUnpack(bufferView, i * elemSize)))
        return result
      }
    }

    if (requester.unpackTransform) {
      const originalUnpack = requester.unpack
      requester.unpack = (view, off) => requester.unpackTransform!(originalUnpack(view, off))
    }
  }

  const totalSize = alignOffset(offset, maxAlign)
  const description = layout.map((f) => ({
    name: f.name,
    offset: f.offset,
    size: f.size,
    align: f.align,
    optional: f.optional,
    type: f.type,
    lengthOf: f.lengthOf,
  }))
  const layoutByName = new Map(description.map((f) => [f.name, f]))
  const arrayFields = new Map(Object.entries(arrayFieldsMetadata))
  const iterableArrayFields = layout.filter((field) => Array.isArray(field.type))
  if (plainPrimitiveFields?.length !== layout.length || plainPrimitiveFields.length === 0) plainPrimitiveFields = null
  const supportsPackListInto = !!plainPrimitiveFields
  if (primitiveDecodeFields?.length !== layout.length || primitiveDecodeFields.length === 0) {
    primitiveDecodeFields = null
  }
  let plainPrimitivePackList: ((objects: any[]) => ArrayBuffer) | undefined
  let plainPrimitiveUnpackList: ((view: DataView, count: number) => any[]) | undefined
  let reducedPrimitiveUnpackList: ((view: DataView, count: number) => any[]) | undefined
  let plainPrimitivePack: ((obj: any) => ArrayBuffer) | undefined
  let plainPrimitivePackInto: ((obj: any, view: DataView, offset: number) => void) | undefined
  let plainPrimitivePackListInto: ((objects: any[], view: DataView, offset: number) => void) | undefined
  let plainPrimitiveUnpack: ((view: DataView) => any) | undefined
  let plainPrimitiveUnpackInto: ((view: DataView, target: any, offset: number) => any) | undefined
  let plainPrimitivePackListItems = 0
  let plainPrimitivePackListIntoItems = 0
  let plainPrimitiveUnpackListItems = 0
  let reducedPrimitiveUnpackListItems = 0
  let plainPrimitivePackCalls = 0
  let plainPrimitivePackIntoCalls = 0
  let plainPrimitiveUnpackCalls = 0
  let plainPrimitiveUnpackIntoCalls = 0

  const compilePlainPrimitive = <T>(compile: () => T): T | undefined => {
    try {
      return compile()
    } catch (error) {
      if (!(error instanceof EvalError)) throw error
      plainPrimitiveFields = null
      primitiveDecodeFields = null
      return undefined
    }
  }

  const validateDecodeRange = (view: DataView, decodeOffset: number): void => {
    if (!Number.isSafeInteger(decodeOffset) || decodeOffset < 0) {
      throw new RangeError(`Decode offset must be a non-negative safe integer, got ${decodeOffset}`)
    }
    if (decodeOffset > view.byteLength - totalSize) {
      throw new RangeError(
        `DataView range (${view.byteLength} bytes) is too small for a struct at offset ${decodeOffset}`,
      )
    }
  }

  const decodeFieldsInto = (target: any, view: DataView, baseOffset: number): void => {
    if (structDefOptions?.default) Object.assign(target, structDefOptions.default)

    for (const field of layout) {
      if (!field.unpack) continue

      try {
        target[field.name] = field.unpack(view, baseOffset + field.offset)
      } catch (error) {
        console.error(`Error unpacking field '${field.name}' at offset ${field.offset}:`, error)
        throw error
      }
    }
  }

  const unpackInto = (view: DataView, target: any, decodeOffset = 0): any => {
    validateDecodeRange(view, decodeOffset)
    if (
      plainPrimitiveFields &&
      (plainPrimitiveUnpackInto || ++plainPrimitiveUnpackIntoCalls >= plainPrimitiveSpecializationThreshold)
    ) {
      plainPrimitiveUnpackInto ??= compilePlainPrimitive(() => compilePlainPrimitiveUnpackInto(plainPrimitiveFields!))
      if (plainPrimitiveUnpackInto) return plainPrimitiveUnpackInto(view, target, decodeOffset)
    }

    decodeFieldsInto(target, view, decodeOffset)
    return target
  }

  const materializeArrayIterables =
    iterableArrayFields.length === 0
      ? null
      : (obj: any) => {
          let normalized = obj

          for (const field of iterableArrayFields) {
            const value = obj[field.name]
            if (value == null || Array.isArray(value) || ArrayBuffer.isView(value)) continue
            if (typeof value[Symbol.iterator] !== "function") continue

            if (normalized === obj) normalized = { ...obj }
            normalized[field.name] = Array.from(value)
          }

          return normalized
        }

  const definition = {
    __type: "struct",
    size: totalSize,
    align: maxAlign,
    hasMapValue: !!structDefOptions?.mapValue,
    layoutByName,
    arrayFields,

    pack(obj: Simplify<StructObjectInputType<Fields>>, options?: StructFieldPackOptions): ArrayBuffer {
      if (
        plainPrimitiveFields &&
        (plainPrimitivePack || ++plainPrimitivePackCalls >= plainPrimitiveSpecializationThreshold)
      ) {
        plainPrimitivePack ??= compilePlainPrimitive(() => compilePlainPrimitivePack(plainPrimitiveFields!, totalSize))
        if (plainPrimitivePack) return plainPrimitivePack(obj)
      }

      const buf = new ArrayBuffer(totalSize)
      const view = new DataView(buf)

      let mappedObj: any = obj
      if (structDefOptions?.mapValue) {
        mappedObj = structDefOptions.mapValue(obj)
      }
      if (materializeArrayIterables) mappedObj = materializeArrayIterables(mappedObj)
      if (hasDirectInlinePack) freshPackBuffers.add(buf)

      try {
        for (const field of layout) {
          const value = (mappedObj as any)[field.name] ?? field.default
          if (!field.optional && value === undefined) {
            fatalError(`Packing non-optional field '${field.name}' but value is undefined (and no default provided)`)
          }
          if (field.validate) {
            for (const validateFn of field.validate) {
              validateFn(value, field.name, {
                hints: options?.validationHints,
                input: mappedObj,
              })
            }
          }
          field.pack(view, field.offset, value, mappedObj, options)
        }
      } finally {
        if (hasDirectInlinePack) freshPackBuffers.delete(buf)
      }
      return view.buffer
    },

    packInto(
      obj: Simplify<StructObjectInputType<Fields>>,
      view: DataView,
      offset: number,
      options?: StructFieldPackOptions,
    ): void {
      if (
        plainPrimitiveFields &&
        (plainPrimitivePackInto || ++plainPrimitivePackIntoCalls >= plainPrimitiveSpecializationThreshold)
      ) {
        plainPrimitivePackInto ??= compilePlainPrimitive(() => compilePlainPrimitivePackInto(plainPrimitiveFields!))
        if (plainPrimitivePackInto) {
          plainPrimitivePackInto(obj, view, offset)
          return
        }
      }

      let mappedObj: any = obj
      if (structDefOptions?.mapValue) {
        mappedObj = structDefOptions.mapValue(obj)
      }
      if (materializeArrayIterables) mappedObj = materializeArrayIterables(mappedObj)

      for (const field of layout) {
        const value = (mappedObj as any)[field.name] ?? field.default
        if (!field.optional && value === undefined) {
          console.warn(
            `packInto missing value for non-optional field '${
              field.name
            }' at offset ${offset + field.offset}. Writing default or zero.`,
          )
        }
        if (field.validate) {
          for (const validateFn of field.validate) {
            validateFn(value, field.name, {
              hints: options?.validationHints,
              input: mappedObj,
            })
          }
        }
        field.pack(view, offset + field.offset, value, mappedObj, options)
      }
    },

    // unpack method now returns the specific inferred object type
    unpack(buf: ArrayBuffer | SharedArrayBuffer): Simplify<any> {
      if (buf.byteLength < totalSize) {
        fatalError(`Buffer size (${buf.byteLength}) is smaller than struct size (${totalSize}) for unpacking.`)
      }
      const view = new DataView(buf)
      if (
        plainPrimitiveFields &&
        (plainPrimitiveUnpack || ++plainPrimitiveUnpackCalls >= plainPrimitiveSpecializationThreshold)
      ) {
        plainPrimitiveUnpack ??= compilePlainPrimitive(() => compilePlainPrimitiveUnpack(plainPrimitiveFields!))
        if (plainPrimitiveUnpack) return plainPrimitiveUnpack(view)
      }
      // Start with struct-level defaults if provided
      const result: any = structDefOptions?.default ? { ...structDefOptions.default } : {}

      for (const field of layout) {
        // Skip fields that don't have an unpacker (e.g., write-only or complex cases not yet impl)
        if (!field.unpack) {
          // This could happen for lengthOf fields if unpack isn't needed, or unimplemented array types
          // console.warn(`Field '${field.name}' has no unpacker defined.`);
          continue
        }

        try {
          result[field.name] = field.unpack(view, field.offset)
        } catch (e: any) {
          console.error(`Error unpacking field '${field.name}' at offset ${field.offset}:`, e)
          throw e // Re-throw after logging context
        }
      }

      if (structDefOptions?.reduceValue) {
        return structDefOptions.reduceValue(result)
      }

      return result as StructObjectOutputType<Fields>
    },

    packList(objects: Simplify<StructObjectInputType<Fields>>[], options?: StructFieldPackOptions): ArrayBuffer {
      if (objects.length === 0) {
        return new ArrayBuffer(0)
      }
      if (plainPrimitiveFields) {
        plainPrimitivePackListItems += objects.length
        if (
          plainPrimitivePackList ||
          (objects.length > 1 && plainPrimitivePackListItems >= plainPrimitiveSpecializationThreshold)
        ) {
          plainPrimitivePackList ??= compilePlainPrimitive(() =>
            compilePlainPrimitivePackList(plainPrimitiveFields!, totalSize),
          )
          if (plainPrimitivePackList) return plainPrimitivePackList(objects)
        }
      }

      const buffer = new ArrayBuffer(totalSize * objects.length)
      const view = new DataView(buffer)
      if (hasDirectInlinePack) freshPackBuffers.add(buffer)

      try {
        for (let i = 0; i < objects.length; i++) {
          let mappedObj: any = objects[i]
          if (structDefOptions?.mapValue) {
            mappedObj = structDefOptions.mapValue(objects[i])
          }
          if (materializeArrayIterables) mappedObj = materializeArrayIterables(mappedObj)

          for (const field of layout) {
            const value = (mappedObj as any)[field.name] ?? field.default
            if (!field.optional && value === undefined) {
              fatalError(
                `Packing non-optional field '${field.name}' at index ${i} but value is undefined (and no default provided)`,
              )
            }
            if (field.validate) {
              for (const validateFn of field.validate) {
                validateFn(value, field.name, {
                  hints: options?.validationHints,
                  input: mappedObj,
                })
              }
            }
            field.pack(view, i * totalSize + field.offset, value, mappedObj, options)
          }
        }
      } finally {
        if (hasDirectInlinePack) freshPackBuffers.delete(buffer)
      }

      return buffer
    },

    packListInto(
      objects: Simplify<StructObjectInputType<Fields>>[],
      view: DataView,
      offset: number,
      options?: StructFieldPackOptions,
    ): void {
      if (objects.length === 0) return
      if (!supportsPackListInto) throw new Error("packListInto only supports required primitive fields")

      if (plainPrimitiveFields) {
        plainPrimitivePackListIntoItems += objects.length
        if (
          plainPrimitivePackListInto ||
          (objects.length > 1 && plainPrimitivePackListIntoItems >= plainPrimitiveSpecializationThreshold)
        ) {
          plainPrimitivePackListInto ??= compilePlainPrimitive(() =>
            compilePlainPrimitivePackListInto(plainPrimitiveFields!, totalSize),
          )
          if (plainPrimitivePackListInto) {
            plainPrimitivePackListInto(objects, view, offset)
            return
          }
        }
      }

      for (let index = 0; index < objects.length; index += 1) {
        ;(definition as any).packInto(objects[index]!, view, offset + index * totalSize, options)
      }
    },

    unpackList(buf: ArrayBuffer | SharedArrayBuffer, count: number): Simplify<StructObjectOutputType<Fields>>[] {
      if (count === 0) {
        return []
      }

      const expectedSize = totalSize * count
      if (buf.byteLength < expectedSize) {
        fatalError(
          `Buffer size (${buf.byteLength}) is smaller than expected size (${expectedSize}) for unpacking ${count} structs.`,
        )
      }

      const view = new DataView(buf)
      if (plainPrimitiveFields && Number.isSafeInteger(count) && count > 1) {
        plainPrimitiveUnpackListItems += count
        if (plainPrimitiveUnpackList || plainPrimitiveUnpackListItems >= plainPrimitiveSpecializationThreshold) {
          plainPrimitiveUnpackList ??= compilePlainPrimitive(() =>
            compilePlainPrimitiveUnpackList(plainPrimitiveFields!, totalSize),
          )
          if (plainPrimitiveUnpackList) return plainPrimitiveUnpackList(view, count)
        }
      }
      if (!plainPrimitiveFields && primitiveDecodeFields && Number.isSafeInteger(count) && count > 1) {
        reducedPrimitiveUnpackListItems += count
        if (reducedPrimitiveUnpackList || reducedPrimitiveUnpackListItems >= plainPrimitiveSpecializationThreshold) {
          reducedPrimitiveUnpackList ??= compilePlainPrimitive(() =>
            compileReducedPrimitiveUnpackList(primitiveDecodeFields!, totalSize, structDefOptions!),
          )
          if (reducedPrimitiveUnpackList) return reducedPrimitiveUnpackList(view, count)
        }
      }
      const preallocated =
        Number.isSafeInteger(count) && count >= arrayPreallocationThreshold && count <= maxArrayLength
      const results: any[] = preallocated ? new Array(count) : []

      for (let i = 0; i < count; i++) {
        const offset = i * totalSize
        const result: any = structDefOptions?.default ? { ...structDefOptions.default } : {}

        for (const field of layout) {
          if (!field.unpack) {
            continue
          }

          try {
            result[field.name] = field.unpack(view, offset + field.offset)
          } catch (e: any) {
            console.error(`Error unpacking field '${field.name}' at index ${i}, offset ${offset + field.offset}:`, e)
            throw e
          }
        }

        if (structDefOptions?.reduceValue) {
          const value = structDefOptions.reduceValue(result)
          if (preallocated) results[i] = value
          else results.push(value)
        } else {
          if (preallocated) results[i] = result as StructObjectOutputType<Fields>
          else results.push(result as StructObjectOutputType<Fields>)
        }
      }

      return results
    },

    describe() {
      return description
    },
  } as unknown as DefineStructReturnType<Fields, Opts>

  if (!structDefOptions?.reduceValue) Object.assign(definition, { unpackInto })

  structInternals.set(definition, {
    layout,
    options: structDefOptions,
    publicPack: definition.pack,
    publicUnpack: definition.unpack,
    hasDirectInlinePack,
    directInlineUnpackSafe,
    materializeArrayIterables,
  })
  return definition
}
