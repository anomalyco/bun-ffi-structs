import { expect, it } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const repoRoot = resolve(import.meta.dir, "../..")
const ffiLoadError = "bun-ffi-structs requires Bun or Node.js with node:ffi enabled (--experimental-ffi --allow-ffi)."

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
