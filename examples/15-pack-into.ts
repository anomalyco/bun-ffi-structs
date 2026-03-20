import { defineStruct } from "../src/structs_ffi.js"

console.log("=== Example 15: packInto for Zero-Copy Writes ===\n")

const Vec3Struct = defineStruct([
  ["x", "f32"],
  ["y", "f32"],
  ["z", "f32"],
] as const)

const ParticleStruct = defineStruct([
  ["id", "u32"],
  ["position", Vec3Struct],
  ["velocity", Vec3Struct],
] as const)

const buffer = new ArrayBuffer(ParticleStruct.size * 3)
const view = new DataView(buffer)

const particles = [
  { id: 1, position: { x: 0, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 } },
  { id: 2, position: { x: 5, y: 0, z: 0 }, velocity: { x: 0, y: 1, z: 0 } },
  { id: 3, position: { x: 0, y: 5, z: 0 }, velocity: { x: 0, y: 0, z: 1 } },
]

console.log("Writing 3 particles to pre-allocated buffer...")

for (let i = 0; i < particles.length; i++) {
  ParticleStruct.packInto(particles[i]!, view, i * ParticleStruct.size)
}

console.log("Buffer size:", buffer.byteLength, "bytes")
console.log("Struct size:", ParticleStruct.size, "bytes")

console.log("\nReading back particles:")
for (let i = 0; i < particles.length; i++) {
  const slice = buffer.slice(i * ParticleStruct.size, (i + 1) * ParticleStruct.size)
  const particle = ParticleStruct.unpack(slice)
  console.log(`  Particle ${i + 1}:`, particle)
}

console.log("\n✓ packInto enables zero-copy writes at specific offsets!")
