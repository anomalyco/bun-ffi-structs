# Benchmarks

The benchmark suite combines OpenTUI production layouts, generic scaling cases, and the complete pre-expansion benchmark set for
`bun-ffi-structs`. Timing and statistics use [Tinybench 6.0.2](https://tinylibs.github.io/tinybench/).

## Run

```bash
# Production, generic, and legacy scenarios except stress-scale cases
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

- `--time` and `--iterations` set Tinybench's minimum measured duration and invocation count.
- `--warmup-time`, `--warmup-iterations`, and `--no-warmup` configure Tinybench warmup.
- `--retain-samples` includes Tinybench's sorted latency and throughput samples in JSON.
- `--max-rme` sets the maximum accepted Tinybench 95% latency RME in strict mode.
- `--strict-rme` enables longer-sample retries and failure when RME remains above the limit.
- `--max-attempts` controls strict-mode retries with longer samples.
- `--allow-unstable` disables only the strict RME failure; operation errors still fail.
- `--verbose` prints Tinybench mean, SD, SEM, MOE, critical value, and execution details.
- `--quiet` suppresses terminal tables while preserving validation, exit status, and optional JSON output.
- `BENCH_PROFILE`, `BENCH_FILTER`, `BENCH_COMMIT`, and `GITHUB_SHA` provide environment equivalents or metadata.

## Reliability

Each scenario:

1. Creates fixtures outside the measured region.
2. Runs a correctness preflight.
3. Runs in a fresh synchronous Tinybench instance with `async: false`, `throws: true`, and `bunNanoseconds` timestamps.
4. Uses Tinybench's automatic warmup and minimum time/iteration stopping conditions.
5. Reports Tinybench p50/p75/p99/p99.5/p99.9, sample variance, SD, SEM, Student-t critical value, MOE, RME, and throughput.
6. Counts attempted operations and the first operation error before Tinybench stops the failed task.
7. Retries high-RME results in a fresh Tinybench instance with a longer measured duration.

Unpack scenarios use prebuilt buffers. They do not include packing in the timed operation. List and array cases report both
call-level latency and normalized item throughput. Timed callbacks discard return values so Tinybench never receives its reserved
`{ overriddenDuration }` result shape; a scenario-name checksum is recorded outside timing for run identification.
Tinybench stops a task at its first thrown operation; the reported error percentage uses that failure and the number of attempted
invocations up to the stop rather than pretending failed iterations continued.
Normal quick, default, and full runs report Tinybench RME without treating host noise as a correctness failure, matching OpenTUI's
reporting convention. `bench:strict` retries unstable tasks with longer Tinybench durations and applies the full profile's 5% RME
gate. Operation errors fail every mode.

JSON output includes Tinybench statistics, configuration, Bun/Node/V8 versions, OS, architecture, CPU model, logical CPU count,
error counts, and the checksum. Raw Tinybench samples are included only with `--retain-samples`.
Tinybench's raw latency statistics and samples are milliseconds, and throughput statistics are operations/second; derived display
fields ending in `Ns` are nanoseconds.

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
Styled-color scenarios mirror OpenTUI's normalization path for existing RGBA owners; they do not claim to measure string color
parsing. Scenarios labeled as isolated unpack components exclude the surrounding native call and renderer work.

Generic library scenarios additionally cover allocation versus `packInto`, schema compilation, primitive and enum arrays,
iterable materialization, nested structs, transforms/validation, UTF-8 scaling, `allocStruct`, and list scaling.

## Legacy Continuity

Every scenario from the benchmark suite that preceded the OpenTUI expansion is retained under `legacy/` using its exact schema,
fixture, cardinality, and memory-iteration setting.

- `legacy/.../pack` preserves the previous pack callback.
- `legacy/.../roundtrip` preserves the previous tasks named “unpack”, whose callbacks actually packed and then unpacked.
- `legacy/.../unpack-only` adds the corrected isolated unpack measurement using a prebuilt buffer.

This covers the original simple, medium, nested, complex, and massive structs; arrays at 10/100/1,000/10,000 elements; both
two-array cases; and every original simple, medium, and complex list size.
