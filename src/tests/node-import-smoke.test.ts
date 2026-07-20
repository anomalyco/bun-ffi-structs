import { expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = resolve(import.meta.dir, "../..")
const ffiLoadError = "bun-ffi-structs requires Bun or Node.js with node:ffi enabled (--experimental-ffi --allow-ffi)."
const nodeFfiProbe = spawnSync(
  "node",
  ["--experimental-ffi", "--input-type=module", "-e", 'await import("node:ffi")'],
  {
    cwd: repoRoot,
    stdio: "pipe",
  },
)
const supportsNodeFfi = nodeFfiProbe.status === 0

if (process.env.REQUIRE_NODE_FFI === "1" && !supportsNodeFfi) {
  throw new Error(`REQUIRE_NODE_FFI=1 but the configured Node.js does not support node:ffi: ${nodeFfiProbe.stderr}`)
}

it("imports in Node without node:ffi until pointer helpers are used", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bun-ffi-structs-node-import-"))

  try {
    const build = spawnSync("bun", ["build", "src/index.ts", "--outdir", tempDir, "--target", "node"], {
      cwd: repoRoot,
      stdio: "pipe",
    })

    expect(build.status).toBe(0)

    const indexUrl = pathToFileURL(join(tempDir, "index.js")).href
    const script = `
      const { defineStruct } = await import(${JSON.stringify(indexUrl)})
      const PrimitiveStruct = defineStruct([["value", "u32"]])
      const packed = PrimitiveStruct.pack({ value: 123 })
      const unpacked = PrimitiveStruct.unpack(packed)
      if (unpacked.value !== 123) {
        throw new Error("primitive struct packing failed")
      }

      const TextStruct = defineStruct([
        ["text", "char*"],
        ["textLen", "u64", { lengthOf: "text" }],
      ])

      let pointerFailed = false
      try {
        TextStruct.pack({ text: "hello" })
      } catch (error) {
        pointerFailed = error instanceof Error && error.message.includes(${JSON.stringify(ffiLoadError)})
      }

      if (!pointerFailed) {
        throw new Error("expected pointer-backed packing to fail with the unsupported backend error")
      }
    `

    const node = spawnSync("node", ["--input-type=module", "-e", script], {
      cwd: repoRoot,
      stdio: "pipe",
    })

    expect(node.status).toBe(0)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

it.skipIf(!supportsNodeFfi)("packs and unpacks pointer-backed data with Node node:ffi", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "bun-ffi-structs-node-ffi-"))

  try {
    const build = spawnSync("bun", ["build", "src/index.ts", "--outdir", tempDir, "--target", "node"], {
      cwd: repoRoot,
      stdio: "pipe",
    })
    expect(build.status).toBe(0)

    const indexUrl = pathToFileURL(join(tempDir, "index.js")).href
    const script = `
      import assert from "node:assert/strict"
      const { defineStruct } = await import(${JSON.stringify(indexUrl)})
      const TextStruct = defineStruct([
        ["text", "char*"],
        ["textLength", "u64", { lengthOf: "text" }],
      ])

      const text = "Node FFI 🌍"
      const unpacked = TextStruct.unpack(TextStruct.pack({ text }))
      assert.equal(unpacked.text, text)
      assert.equal(unpacked.textLength, BigInt(Buffer.byteLength(text)))

      const PointerStruct = defineStruct([["value", "pointer"]])
      const pointer = PointerStruct.unpack(PointerStruct.pack({ value: new Uint8Array([1, 2, 3]) })).value
      assert.equal(typeof pointer, "bigint")
      assert.notEqual(pointer, 0n)
    `

    const node = spawnSync("node", ["--experimental-ffi", "--input-type=module", "-e", script], {
      cwd: repoRoot,
      stdio: "pipe",
    })
    expect(node.status, node.stderr.toString()).toBe(0)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
