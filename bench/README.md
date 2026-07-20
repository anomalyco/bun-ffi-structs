# Benchmarks

The benchmark suite combines OpenTUI production layouts with generic scaling cases for `bun-ffi-structs`.

## Run

```bash
# Production-focused default profile
bun run bench

# Fast correctness and harness smoke run
bun run bench -- --profile quick

# Every production, extended, and stress scenario
bun run bench -- --profile full

# Convenience scripts: full report versus strict full-profile RME gate
bun run bench:full
bun run bench:strict

# Select scenarios
bun run bench -- --filter styled-chunks
bun run bench -- --scenario opentui/span-info/unpack-list/256
bun run bench -- --list

# Machine-readable output and repeated retained-memory measurements
bun run bench -- --json out/bench.json
bun run bench -- --filter styled-chunks --memory --memory-trials 5
```

Useful controls:

- `--iterations`, `--warmup`, `--rounds`, and `--min-sample-ms` configure sampling.
- `--max-rme` sets the maximum accepted 95% relative margin of error.
- `--max-attempts` controls automatic retries with longer samples.
- `--max-batch` caps a calibrated batch before the duration loop repeats it.
- `--allow-unstable` reports high-RME results without failing the process.
- `--verbose` prints every measured round.
- `--quiet` suppresses terminal tables while preserving validation, exit status, and optional JSON output.
- `BENCH_PROFILE`, `BENCH_FILTER`, `BENCH_COMMIT`, and `GITHUB_SHA` provide environment equivalents or metadata.

## Reliability

Each scenario:

1. Creates fixtures outside the measured region.
2. Runs a correctness preflight.
3. Warms up before calibration.
4. Calibrates a batch to a minimum sample duration.
5. Measures independent rounds with `process.hrtime.bigint()`.
6. Reports median and p95 latency, sample standard deviation, Student-t 95% RME, throughput, and operation error rate.
7. Retries unstable results with longer samples and fails if errors occur or RME remains above the configured limit.

Unpack scenarios use prebuilt buffers. They do not include packing in the timed operation. List and array cases report both
call-level latency and normalized item throughput. A global checksum consumes results so benchmark calls remain observable.
The quick profile is a smoke run with a deliberately broad RME allowance. Default and full profiles enforce tighter RME limits
and fail if a result remains unstable after progressively longer retries; `--allow-unstable` is an explicit reporting-only mode.
The `bench:full` convenience script uses reporting-only mode because allocation-heavy stress scenarios can expose genuine GC
variance; operation errors still fail. `bench:strict` applies the full profile's 5% RME gate.

JSON output includes raw rounds, configuration, Bun/Node/V8 versions, OS, architecture, CPU model, logical CPU count, error
counts, and the checksum.

The optional memory mode runs repeated trials with forced GC and subtracts a same-sized retention-array control. It reports
retained output memory, not transient peak allocation or a leak claim. RSS and heap reservation remain runtime-level signals and
should be compared across repeated runs on the same machine.

## OpenTUI Mapping

Production schemas mirror `packages/core/src/zig-structs.ts` in OpenTUI. Scenarios cover:

- `StyledChunkStruct.packList` with the exact plain-string chunk and extended pre-normalized RGBA/link inputs.
- `AudioStreamStatsStruct.unpack`, used by readiness and backpressure polling at a code-defined 5 ms interval.
- `SpanInfoStruct.unpackList` at one record and the code-defined 256-record drain maximum.
- `LineInfoStruct.unpack` with four native `u32` arrays.
- Logical and visual cursor reads.
- Table measurement batches.
- Highlight pack/unpack, cursor styles, terminal capabilities, Unicode output, NativeSpanFeed, audio options, and stats.

OpenTUI establishes a one-chunk case for plain strings and a 256-record maximum for span drains. It does not establish an
empirical distribution for styled chunk counts, viewport heights, document lengths, highlight counts, or Unicode output sizes.
The larger values in this suite are therefore labeled extended or stress scaling cases rather than claimed production averages.
OpenTUI's `normalizeColorValue` work is outside this library; styled-color scenarios begin with the owning RGBA buffers consumed
by `bun-ffi-structs`. Scenarios labeled as isolated unpack components exclude the surrounding native call and renderer work.

Generic library scenarios additionally cover allocation versus `packInto`, schema compilation, primitive and enum arrays,
iterable materialization, nested structs, transforms/validation, UTF-8 scaling, `allocStruct`, and list scaling.
