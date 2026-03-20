#!/bin/bash
set -e

echo "Building package..."
bun build src/index.ts --outdir dist --target node

echo "Generating TypeScript declarations..."
bunx tsc --project tsconfig.build.json

echo "Copying package files..."
cp package.json dist/
cp README.md dist/
cp LICENSE dist/ 2>/dev/null || echo "No LICENSE file found"

echo "Updating dist/package.json..."
cd dist
cat package.json | \
  sed 's|"module": "src/index.ts"|"module": "index.js"|' | \
  sed 's|"main": "src/index.ts"|"main": "index.js"|' | \
  sed 's|"types": "src/index.ts"|"types": "index.d.ts"|' | \
  sed 's|"./dist/index.d.ts"|"./index.d.ts"|' | \
  sed 's|"./dist/index.js"|"./index.js"|' > package.json.tmp
mv package.json.tmp package.json

echo "Build completed successfully!"
