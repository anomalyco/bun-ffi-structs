# bun-ffi-structs

TypeScript struct-packing library for Bun and Node.js `node:ffi` workflows. Define and pack/unpack C-style structs with memory layout control for FFI calls.

## Features

- **Type-safe struct definitions** with primitives (u8, u16, u32, u64, i16, i32, i64, f32, f64, bool_u8, bool_u32, pointer)
- **Enums** with custom base types and bidirectional mapping
- **Nested structs** (inline or as pointers)
- **Arrays** of primitives, enums, structs, and object pointers
- **Automatic alignment** following C struct layout rules (little-endian)
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

Using the package on Node.js currently requires `node:ffi` support to be enabled, for example with `--experimental-ffi --allow-ffi` on supported builds.

For local development, use `scripts/link-dev.sh <target-project-root>` to symlink this package into another project's node_modules.

## Usage

See [examples/README.md](examples/README.md) for runnable examples demonstrating various features.

```typescript
import { defineStruct, defineEnum, allocStruct, objectPtr } from "./structs_ffi"

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

Definitions without a top-level `reduceValue` can decode into an existing object and `DataView`. The target is mutated and returned;
properties unrelated to the struct are retained.

```typescript
const CursorStruct = defineStruct([
  ["row", "u32"],
  ["col", "u32"],
])

const packed = CursorStruct.pack({ row: 4, col: 8 })
const cursor = {}
CursorStruct.unpackInto(new DataView(packed), cursor)
```

Required primitive-only definitions can also pack lists into reusable storage:

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

`packListInto` deliberately rejects definitions with pointers, strings, arrays, defaults, transforms, validation, mapping, or nested
structs. Those definitions require stronger dirty-buffer and pointer-owner replacement semantics than reusable primitive storage.
