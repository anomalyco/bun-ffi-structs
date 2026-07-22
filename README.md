# bun-ffi-structs

TypeScript struct-packing library for Bun and Node.js `node:ffi` workflows. Define and pack/unpack C-style structs with memory layout control for FFI calls.

## Features

- **Type-safe struct definitions** with primitives (u8, u16, u32, u64, i16, i32, i64, f32, f64, bool_u8, bool_u32, pointer)
- **Enums** with custom base types and bidirectional mapping
- **Nested structs** (inline or as pointers)
- **Arrays** of primitives, enums, structs, and object pointers
- **Fixed little-endian layout** with size-based alignment tested on x64 and arm64
- **Field options**: optional, defaults, validation, transforms (packTransform, unpackTransform)
- **Conditional fields** for platform-specific layouts
- **mapValue/reduceValue** transformations for input/output type conversions
- **Object pointers** for referencing external objects with `.ptr` property
- **Allocation utilities** with pre-allocated sub-buffers for arrays
- **C strings** (null-terminated) and raw string pointers
- **Reusable decoding** into caller-owned objects and `DataView` storage
- **Reusable primitive lists** with `packListInto`

## Installation

```bash
bun install bun-ffi-structs
```

Pure primitive layouts work on Node.js without FFI flags. Pointer-backed operations require Node.js 26.1 or newer with
`--experimental-ffi`; when using Node's Permission Model, also pass `--permission --allow-ffi`.

For local development, run `bun run build`, then use `scripts/link-dev.sh <target-project-root>` to symlink this package into
another project's `node_modules`.

## Usage

See [examples/README.md](examples/README.md) for runnable examples demonstrating various features.

```typescript
import { defineStruct, defineEnum, allocStruct, objectPtr } from "bun-ffi-structs"

const ColorEnum = defineEnum({ RED: 0, GREEN: 1, BLUE: 2 })

const PositionStruct = defineStruct([
  ["x", "f32"],
  ["y", "f32"],
  ["z", "f32"],
])

const ObjectStruct = defineStruct([
  ["id", "u32"],
  ["position", PositionStruct],
  ["color", ColorEnum],
  ["count", "u32", { lengthOf: "items" }],
  ["items", ["u32"]],
])

const buffer: ArrayBuffer = ObjectStruct.pack({
  id: 42,
  position: { x: 1.0, y: 2.0, z: 3.0 },
  color: "BLUE",
  items: [10, 20, 30],
})

const unpacked = ObjectStruct.unpack(buffer)
// -> resolves to type {
//   id: number
//   position: { x: number, y: number, z: number }
//   color: "RED" | "GREEN" | "BLUE"
//   items: Iterable<number>
//   count?: number | null | undefined
// }
```

### Reusable Storage

Definitions without a top-level `reduceValue` expose
`unpackInto(view, target, offset = 0)`. The offset is relative to the supplied `DataView`, the complete struct must fit before any
target mutation occurs, and the same target is returned. Struct defaults are reapplied before decoding, `mapValue` is not called,
and unrelated target properties remain unless overwritten by a struct default. Nested values, strings, and arrays can still allocate.

```typescript
const CursorStruct = defineStruct([
  ["row", "u32"],
  ["col", "u32"],
])

const packed = CursorStruct.pack({ row: 4, col: 8 })
const cursor = {}
CursorStruct.unpackInto(new DataView(packed), cursor)
```

Option-free definitions containing only required, non-pointer primitive fields expose
`packListInto(objects, view, offset, options?)`:

```typescript
const buffer = new ArrayBuffer(CursorStruct.size * 2)
CursorStruct.packListInto(
  [
    { row: 1, col: 2 },
    { row: 3, col: 4 },
  ],
  new DataView(buffer),
  0,
)
```

`packListInto` deliberately excludes enums, pointers, strings, arrays, defaults, transforms, validation, mapping, reducers, and
nested structs. Those definitions require stronger dirty-buffer or pointer-owner semantics than reusable primitive storage.

Hot required-primitive `pack`, `packInto`, `packList`, `packListInto`, `unpack`, and `unpackInto` paths are generated after a measured
warmup threshold. Primitive `unpackList` definitions with `reduceValue` receive equivalent specialization while preserving the reducer
callback. Environments that disable string code generation automatically continue on the generic implementations.
