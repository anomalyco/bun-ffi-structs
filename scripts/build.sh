#!/bin/bash
set -e

echo "Building package..."
bun build src/index.ts --outdir dist --target node

echo "Generating TypeScript declarations..."
bunx tsc --project tsconfig.build.json

echo "Build completed successfully!"
