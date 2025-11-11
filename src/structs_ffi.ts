import { ptr, toArrayBuffer } from "bun:ffi"
import type {
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
} from "./types"

function fatalError(...args: any[]): never {
  const message = args.join(" ")
  console.error("FATAL ERROR:", message)
  throw new Error(message)
}

export const pointerSize = process.arch === "x64" || process.arch === "arm64" ? 8 : 4

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
  const { pack: pointerPacker } = primitivePackers("pointer")

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
  type: PrimitiveType | EnumDef<any> | StructDef<any> | "cstring" | "char*" | ObjectPointerDef<any> | readonly [any]
  lengthOf?: string
}

function isStruct(type: any): type is StructDef<any> {
  return typeof type === "object" && type.__type === "struct"
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
      pack = (view: DataView, off: number, val: bigint | number) => {
        pointerSize === 8
          ? view.setBigUint64(off, val ? BigInt(val) : 0n, true)
          : view.setUint32(off, val ? Number(val) : 0, true)
      }
      unpack = (view: DataView, off: number): number => {
        const bint = pointerSize === 8 ? view.getBigUint64(off, true) : BigInt(view.getUint32(off, true))
        return Number(bint)
      }
      break
    default:
      // This should be caught by PrimitiveType, but belts and suspenders
      fatalError(`Unsupported primitive type: ${type}`)
  }

  return { pack, unpack }
}

const { pack: pointerPacker, unpack: pointerUnpacker } = primitivePackers("pointer")

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
  const layout: StructLayoutField[] = []
  const lengthOfFields: Record<string, StructLayoutField> = {}
  const lengthOfRequested: {
    requester: StructLayoutField
    def: EnumDef<any> | PrimitiveType | "char*"
  }[] = []
  const arrayFieldsMetadata: Record<string, ArrayFieldMetadata> = {}

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

    // Primitive
    if (isPrimitiveType(typeOrStruct)) {
      size = typeSizes[typeOrStruct]
      align = typeAlignments[typeOrStruct]
      ;({ pack, unpack } = primitivePackers(typeOrStruct))
      // CString (null-terminated)
    } else if (typeof typeOrStruct === "string" && typeOrStruct === "cstring") {
      size = pointerSize
      align = pointerSize
      pack = (view: DataView, off: number, val: string | null) => {
        const bufPtr = val ? ptr(encoder.encode(val + "\0")) : null
        pointerPacker(view, off, bufPtr)
      }
      unpack = (view: DataView, off: number) => {
        // TODO: Unpack CString from pointer
        const ptrVal = pointerUnpacker(view, off)
        return ptrVal // Returning pointer for now
      }
      // char* (raw string pointer, length usually external)
    } else if (typeof typeOrStruct === "string" && typeOrStruct === "char*") {
      size = pointerSize
      align = pointerSize
      pack = (view: DataView, off: number, val: string | null) => {
        const bufPtr = val ? ptr(encoder.encode(val)) : null // No null terminator
        pointerPacker(view, off, bufPtr)
      }
      // Initial unpack returns pointer; will be replaced if lengthOf field exists
      unpack = (view: DataView, off: number) => {
        const ptrVal = pointerUnpacker(view, off)
        return ptrVal
      }
      needsLengthOf = true // Mark for later resolution
      // Enum
    } else if (isEnum(typeOrStruct)) {
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
      if (options.asPointer === true) {
        size = pointerSize
        align = pointerSize
        pack = (view, off, val, obj, options) => {
          if (!val) {
            pointerPacker(view, off, null)
            return
          }
          const nestedBuf = typeOrStruct.pack(val, options)
          pointerPacker(view, off, ptr(nestedBuf))
        }
        unpack = (view, off) => {
          throw new Error("Not implemented yet")
        }
      } else {
        // Inline struct
        size = typeOrStruct.size
        align = typeOrStruct.align
        pack = (view, off, val, obj, options) => {
          const nestedBuf = typeOrStruct.pack(val, options)
          const nestedView = new Uint8Array(nestedBuf)
          const dView = new Uint8Array(view.buffer)
          dView.set(nestedView, off)
        }
        unpack = (view, off) => {
          const slice = view.buffer.slice(off, off + size)
          return typeOrStruct.unpack(slice)
        }
      }
      // Object Pointer
    } else if (isObjectPointerDef(typeOrStruct)) {
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
      const [def] = typeOrStruct
      size = pointerSize // Arrays are always represented by a pointer to the data
      align = pointerSize
      let arrayElementSize: number

      if (isEnum(def)) {
        // Packing an array of enums
        arrayElementSize = typeSizes[def.type]
        pack = (view, off, val: string[], obj) => {
          if (!val || val.length === 0) {
            pointerPacker(view, off, null)
            return
          }
          const buffer = new ArrayBuffer(val.length * arrayElementSize)
          const bufferView = new DataView(buffer)
          for (let i = 0; i < val.length; i++) {
            const num = def.to(val[i]!)
            bufferView.setUint32(i * arrayElementSize, num, true)
          }
          pointerPacker(view, off, ptr(buffer))
        }
        unpack = null!
        needsLengthOf = true
        lengthOfDef = def
      } else if (isStruct(def)) {
        // Array of Structs
        arrayElementSize = def.size
        pack = (view, off, val: any[], obj, options) => {
          if (!val || val.length === 0) {
            pointerPacker(view, off, null)
            return
          }
          const buffer = new ArrayBuffer(val.length * arrayElementSize)
          const bufferView = new DataView(buffer)
          for (let i = 0; i < val.length; i++) {
            def.packInto(val[i], bufferView, i * arrayElementSize, options)
          }
          pointerPacker(view, off, ptr(buffer))
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
        }
        unpack = null!
        needsLengthOf = true
        lengthOfDef = def
      } else if (isObjectPointerDef(def)) {
        arrayElementSize = pointerSize
        pack = (view, off, val) => {
          if (!val || val.length === 0) {
            pointerPacker(view, off, null)
            return
          }

          const packedView = packObjectArray(val)
          pointerPacker(view, off, ptr(packedView.buffer))
        }
        unpack = () => {
          // TODO: implement unpack for class pointers
          throw new Error("not implemented yet")
        }
      } else {
        throw new Error(`Unsupported array element type for ${name}: ${JSON.stringify(def)}`)
      }

      // Used for allocStruct
      const lengthOfField = Object.values(lengthOfFields).find((f) => f.lengthOf === name)
      if (lengthOfField && isPrimitiveType(lengthOfField.type)) {
        const { pack: lengthPack } = primitivePackers(lengthOfField.type)
        arrayFieldsMetadata[name] = {
          elementSize: arrayElementSize,
          arrayOffset: offset,
          lengthOffset: lengthOfField.offset,
          lengthPack,
        }
      }
    } else {
      throw new Error(`Unsupported field type for ${name}: ${JSON.stringify(typeOrStruct)}`)
    }

    offset = alignOffset(offset, align)

    if (options.unpackTransform) {
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
      requester.unpack = (view, off) => {
        const ptrAddress = pointerUnpacker(view, off)
        const length = lengthOfField.unpack(view, lengthOfField.offset)

        if (ptrAddress === 0 || length === 0) {
          return null
        }

        const byteLength = typeof length === "bigint" ? Number(length) : length
        const buffer = toArrayBuffer(ptrAddress, 0, byteLength)
        return decoder.decode(buffer)
      }
    } else if (isPrimitiveType(def)) {
      const elemSize = typeSizes[def]
      const { unpack: primitiveUnpack } = primitivePackers(def)

      requester.unpack = (view, off) => {
        const result = []
        const length = lengthOfField.unpack(view, lengthOfField.offset)
        const ptrAddress = pointerUnpacker(view, off)

        if (ptrAddress === 0n && length > 0) {
          throw new Error(`Array field ${requester.name} has null pointer but length ${length}.`)
        }
        if (ptrAddress === 0n || length === 0) {
          return []
        }

        const buffer = toArrayBuffer(ptrAddress, 0, length * elemSize)
        const bufferView = new DataView(buffer)

        for (let i = 0; i < length; i++) {
          result.push(primitiveUnpack(bufferView, i * elemSize))
        }
        return result
      }
    } else {
      const elemSize = def.type === "u32" ? 4 : 8

      requester.unpack = (view, off) => {
        const result = []
        const length = lengthOfField.unpack(view, lengthOfField.offset)
        const ptrAddress = pointerUnpacker(view, off)

        if (ptrAddress === 0n && length > 0) {
          throw new Error(`Array field ${requester.name} has null pointer but length ${length}.`)
        }
        if (ptrAddress === 0n || length === 0) {
          return []
        }

        const buffer = toArrayBuffer(ptrAddress, 0, length * elemSize)
        const bufferView = new DataView(buffer)

        for (let i = 0; i < length; i++) {
          result.push(def.from(bufferView.getUint32(i * elemSize, true)))
        }
        return result
      }
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

  return {
    __type: "struct",
    size: totalSize,
    align: maxAlign,
    hasMapValue: !!structDefOptions?.mapValue,
    layoutByName,
    arrayFields,

    pack(obj: Simplify<StructObjectInputType<Fields>>, options?: StructFieldPackOptions): ArrayBuffer {
      const buf = new ArrayBuffer(totalSize)
      const view = new DataView(buf)

      let mappedObj: any = obj
      if (structDefOptions?.mapValue) {
        mappedObj = structDefOptions.mapValue(obj)
      }

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
      return view.buffer
    },

    packInto(
      obj: Simplify<StructObjectInputType<Fields>>,
      view: DataView,
      offset: number,
      options?: StructFieldPackOptions,
    ): void {
      let mappedObj: any = obj
      if (structDefOptions?.mapValue) {
        mappedObj = structDefOptions.mapValue(obj)
      }

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

      const buffer = new ArrayBuffer(totalSize * objects.length)
      const view = new DataView(buffer)

      for (let i = 0; i < objects.length; i++) {
        let mappedObj: any = objects[i]
        if (structDefOptions?.mapValue) {
          mappedObj = structDefOptions.mapValue(objects[i])
        }

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

      return buffer
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
      const results: any[] = []

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
          results.push(structDefOptions.reduceValue(result))
        } else {
          results.push(result as StructObjectOutputType<Fields>)
        }
      }

      return results
    },

    describe() {
      return description
    },
  } as DefineStructReturnType<Fields, Opts>
}
