import type { Pointer } from "./types.js"

interface FfiBackend {
  ptr(value: ArrayBufferLike | ArrayBufferView): Pointer
  toArrayBuffer(pointer: Pointer, offset: number | undefined, length: number): ArrayBuffer
}

interface BunFfiModule {
  ptr(value: ArrayBufferLike | ArrayBufferView): number
  toArrayBuffer(pointer: number, offset: number | undefined, length: number): ArrayBuffer
}

interface NodeFfiModule {
  getRawPointer(source: ArrayBuffer): bigint
  toArrayBuffer(pointer: bigint, length: number, copy?: boolean): ArrayBuffer
}

const FFI_LOAD_ERROR =
  "bun-ffi-structs pointer operations require Bun or Node.js 26.1+ with node:ffi enabled (--experimental-ffi)."

const backend = await loadBackend()

function unavailable(cause?: unknown): never {
  throw new Error(FFI_LOAD_ERROR, {
    cause: cause instanceof Error ? cause : undefined,
  })
}

function createUnsupportedBackend(cause?: unknown): FfiBackend {
  return {
    ptr() {
      return unavailable(cause)
    },
    toArrayBuffer() {
      return unavailable(cause)
    },
  }
}

async function loadBackend(): Promise<FfiBackend> {
  if (typeof process !== "undefined" && "bun" in process.versions) {
    return createBunBackend(await importModule<BunFfiModule>("bun:ffi"))
  }

  try {
    return createNodeBackend(await importModule<NodeFfiModule>("node:ffi"))
  } catch (error) {
    return createUnsupportedBackend(error)
  }
}

function importModule<T>(specifier: string): Promise<T> {
  return import(specifier).then((module) => (module as { default?: T }).default ?? (module as T))
}

function createBunBackend(bun: BunFfiModule): FfiBackend {
  return {
    ptr: bun.ptr,
    toArrayBuffer(pointer, offset, length) {
      return bun.toArrayBuffer(toBunPointer(pointer), offset, length)
    },
  }
}

function createNodeBackend(nodeFfi: NodeFfiModule): FfiBackend {
  return {
    ptr(value) {
      if (ArrayBuffer.isView(value)) {
        const pointer = nodeFfi.getRawPointer(value.buffer as ArrayBuffer)
        return value.byteOffset === 0 ? pointer : pointer + BigInt(value.byteOffset)
      }

      if (value instanceof ArrayBuffer) {
        return nodeFfi.getRawPointer(value)
      }

      throw new TypeError("node:ffi ptr() only supports ArrayBuffer and ArrayBufferView values.")
    },
    toArrayBuffer(pointer, offset, length) {
      return nodeFfi.toArrayBuffer(toBigIntPointer(pointer) + BigInt(offset ?? 0), length, false)
    },
  }
}

function toBigIntPointer(pointer: Pointer): bigint {
  return typeof pointer === "bigint" ? pointer : BigInt(pointer)
}

function toBunPointer(pointer: Pointer): number {
  return typeof pointer === "bigint" ? Number(pointer) : pointer
}

export const ptr = backend.ptr
export const toArrayBuffer = backend.toArrayBuffer
