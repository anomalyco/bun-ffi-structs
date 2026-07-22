# bun-ffi-structs Examples

This directory contains standalone runnable examples demonstrating different features of the bun-ffi-structs library.

## Running Examples

Run any example with Bun:

```bash
bun run examples/01-basic-primitives.ts
```

Run all top-level examples:

```bash
./examples/run-all.sh
```

## Native FFI Example

The `native/` subdirectory contains a complete example of using bun-ffi-structs with actual native Zig code:

### Prerequisites

- Zig compiler installed
- Bun runtime

### Running the Native Example

```bash
cd examples/native
./build.sh    # Compile the Zig dynamic library
bun index.ts  # Run the TypeScript example
```

## Limitations

- Unpacking arrays of structs is not yet implemented (see examples 09, 10)
- Unpacking scalar object pointers returns the raw pointer value, not the reconstructed object
- Unpacking arrays of object pointers is not yet implemented
