# 17695 - Opencode Issue 2

Author: Shuxin Liu (shuxinl2)
Request 02: Show me why formatting my file did nothing. (https://github.com/CMU-17695/opencode/issues/2)

## Combine and Run

Use Bun 1.3.14, Node.js, and Git. From the repository root:

```sh
bun install --frozen-lockfile
cd packages/opencode
bun dev
```

Configure a model provider to use the interactive agent.

## Change

`Format.file()` returns `skipped`, `success`, or `failed`, with ordered outcomes for the formatters actually attempted. Success means a formatter exited zero; it does not imply that file contents changed. stdout and stderr are captured separately, each limited to 64 KiB, with truncation flags.

Before formatting, the service saves one byte snapshot containing the tool’s requested edit. Snapshot failure prevents formatter execution. Execution stops at the first formatter failure and restores that snapshot, undoing all formatting changes while preserving the requested edit. Restoration failure reports both errors and marks final contents as uncertain.

Write, both edit paths, and apply_patch share `Format.report()` for consistent failure details. Edit rereads disk after failure and reports an unconfirmed diff if that read fails. Patch formats added, updated, and moved targets, skips deletions, and keeps formatter output out of titles.

`Status`, `status()`, and the `/instance` formatter status response remain unchanged. No public Protocol or HttpApi changes or SDK regeneration were needed.

## Checks and Results

Run from `packages/opencode`.

1. New failure and tool integration tests:

```sh
bun test --timeout 30000 test/format/failure.test.ts test/tool/format-failure.test.ts
```

2. Selected regression suite:

```sh
bun test --timeout 30000 --only-failures test/format test/tool/format-failure.test.ts test/tool/write.test.ts test/tool/edit.test.ts test/tool/apply_patch.test.ts test/server/httpapi-sdk.test.ts
```

3. Package type checking:

```sh
bun typecheck
```

Verify in the independent copy on Windows with Bun 1.3.14:

| Check | Actual result |
| --- | --- |
| New failure and integration tests | 10 passed, 0 failed; 49 assertions across 2 files |
| Selected regression suite | 111 passed, 0 failed; 248 assertions across 7 files |
| Package type checking | Passed; exit code 0 |

Evidence:
<img src="1.png" width="400">

The 10 new tests are included in the 111-test regression suite. The results do not establish that the entire repository’s test suite passes.

Coverage includes the following situations:
partial writes followed by exit 1, missing binaries, stopping at the first failure, undoing earlier successful formatting, successful changes and no-ops, snapshot and restoration failures, bounded output, consistent reporting across tools, patch moves, and deletions. Existing tests cover formatter status, parallel enabled checks, sequential execution, BOM preservation, CRLF edits, diff statistics, and HTTP SDK behavior.

## RFC Alignment

The implementation follows the initial RFC and the review responses: structured outcomes, ordered execution, one snapshot after the requested edit, stopping at the first failure, restoration of all formatting changes, shared failure reporting, and unchanged formatter status interfaces.

Implementation was finalized during development with some more details which were not specified in the RFC. Including truncation flags, the shared `Format.report()` function, and reporting snapshot failures through `snapshotError` without formatter outcomes.

## Limitations and Remaining Work

Validation used an independent source copy with directory junctions reusing installed dependencies. The Windows `tsgo` executable and standard library files were missing and were supplied locally. Dependency links were also repaired to resolve duplicate plugin types. Repository scripts were unchanged, but clean-install reproducibility remains unverified.

Future work could add a formatter timeout so a stalled process does not block the tool indefinitely. Recovery could also check for concurrent file changes before restoring the snapshot, reducing the risk of overwriting another edit.
