# 17695 - Opencode - Team 8

Repository: [MonaZYX/opencode](https://github.com/MonaZYX/opencode).

The combined version brings together Requests 02, 05, 08, and 09: formatter failure reporting, shell permission reuse, LSP selection, and command name-clash warnings. The changes cover different stages of agent use: choosing commands, approving shell commands, obtaining diagnostics, and formatting edited files. Each student's design changes and limitations are recorded below.

The combined checks reported below used `main` at `c4633a1`. Each student's `submission.txt` identifies the exact final commit to grade.

### Run

Use Bun 1.3.14, Node.js, and Git. From the repository root:

```sh
bun install --frozen-lockfile
cd packages/opencode
bun dev
```

Configure a model provider to use the interactive agent.

### Check

Run the relevant checks from the indicated package, not the repository root.

From `packages/opencode`:

```sh
# Formatter recovery and tool reporting
bun test --timeout 30000 test/format test/tool/format-failure.test.ts test/tool/write.test.ts test/tool/edit.test.ts test/tool/apply_patch.test.ts

# Request 05: shell classification and permission behavior
bun test --timeout 30000 test/tool/shell-classify.test.ts test/tool/shell.test.ts test/permission

# Command precedence and warnings
bun test --timeout 30000 test/command

# LSP selection and configuration
bun test --timeout 30000 test/lsp test/config/lsp.test.ts test/config/v2-compat.test.ts test/tool/lsp.test.ts

bun typecheck
```

From `packages/core`:

```sh
bun test --timeout 30000 test/permission.test.ts
bun typecheck
```

From `packages/schema`:

```sh
bun test --timeout 30000 test/permission-command.test.ts
```

From `packages/app`:

```sh
bun test --conditions=solid --preload ./happydom.ts ./src/context/permission-auto-respond.test.ts
bun typecheck
```

### Combined Results and Limits

At `c4633a1`, the command/skill/ACP/session-prompt/format checks passed 123 tests with zero failures and one skipped; LSP/config checks passed 119 tests with zero failures. Core and opencode type checking passed, as recorded in the individual sections. These are selected checks with potentially overlapping coverage, not a passing full repository suite. Request 05's results below are from its individual validation, while Request 02's separate 111-test result comes from an independent Windows copy. Clean-install reproducibility and full end-to-end validation of all four features together remain unverified in this report.

## Request 05 — Yifan Jiang (yj3)

Stop re-asking me when I put a flag before the subcommand. (https://github.com/CMU-17695/opencode/issues/5)

### Change

Supported flag-placement variants (`npm --silent`, `git -C`, and `docker compose -f/--file`) now share a canonical command identity and Always pattern. Canonical Always reuse is considered only when no configured or remembered raw permission rule matches; matching raw allow, deny, and explicit ask decisions remain unchanged.

### Checks and Results

In Request 05 validation, the three tested npm flag-placement variants produced 3 → 1 distinct Always patterns, and reuse after approving `npm run test *` improved from 1/3 → 3/3. Focused shell/permission/arity tests passed 115/0, focused schema tests passed 9/0, existing Web permission tests passed 12/0, and type checking passed in six affected packages.

### Changed from RFC

The main RFC design was retained. An additional safety check disables canonicalization when extracted shell tokens do not fully represent the original command, including variable expansion, assignments, or redirection; these cases preserve the existing raw behavior.

### Remaining

Classification is limited to the supported npm/git/docker option forms; unknown or ambiguous forms retain raw behavior. PowerShell and cmd normalization were not implemented, and cross-platform manual testing was not performed.

## Request 02 — Shuxin Liu (shuxinl2)

Show me why formatting my file did nothing. (https://github.com/CMU-17695/opencode/issues/2)

### Change

`Format.file()` returns `skipped`, `success`, or `failed`, with ordered outcomes for the formatters actually attempted. Success means a formatter exited zero; it does not imply that file contents changed. stdout and stderr are captured separately, each limited to 64 KiB, with truncation flags.

Before formatting, the service saves one byte snapshot containing the tool’s requested edit. Snapshot failure prevents formatter execution. Execution stops at the first formatter failure and restores that snapshot, undoing all formatting changes while preserving the requested edit. Restoration failure reports both errors and marks final contents as uncertain.

Write, both edit paths, and apply_patch share `Format.report()` for consistent failure details. Edit rereads disk after failure and reports an unconfirmed diff if that read fails. Patch formats added, updated, and moved targets, skips deletions, and keeps formatter output out of titles.

`Status`, `status()`, and the `/instance` formatter status response remain unchanged. No public Protocol or HttpApi changes or SDK regeneration were needed.

### Changed from RFC

The agreed structured outcomes and stop-and-restore policy remain unchanged. The output limit increased from 8 KiB to 64 KiB per stream, with explicit truncation flags. The implementation also makes recovery errors explicit: snapshot failure prevents formatting, and restoration failure reports uncertain final contents. A shared `Format.report()` provides consistent failure messages, while edit rereads disk and omits unconfirmed final diff metadata if that read fails.

### Checks and Results

In the independent Windows copy with Bun 1.3.14, 111 selected tests passed, including 10 new tests. Type checking passed after local dependency repairs.

### Remaining

Validation reused dependencies with local Windows repairs; clean installation remains unverified. Future work could add formatter timeouts and detect concurrent edits before restoration.

## Request 09 — Mona Zhang (MonaZYX)

Warn me when two of my commands have the same name. (https://github.com/CMU-17695/opencode/issues/9)

### Change

Before this change, which command won a name clash depended only on loop order in `init()`, and the user was never told. I split `init()` in [`command/index.ts`](packages/opencode/src/command/index.ts) into one loader per source and a single `merge()` step that follows an explicit precedence list: config, skill, MCP, then built-in. Each name keeps its original palette position. On a clash, the TUI shows a toast naming the winner and the hidden commands, for example "/review is defined more than once. Using config /review. Hidden: built-in /review." The same message is logged outside the TUI. `Command.Info` and the HTTP API are unchanged.

### Checks and Results

A baseline test that records the no-clash command list (names, order, source) passed on the original `main` and still passes after the change. New tests in [`merge.test.ts`](packages/opencode/test/command/merge.test.ts) and [`service.test.ts`](packages/opencode/test/command/service.test.ts) cover precedence for every source pair in both orders, kept positions, lazy MCP prompts, and one toast per clash with none otherwise. On the combined `main` (`c4633a1`), the command, skill, ACP, session prompt, and format tests passed 123/0 with 1 skipped, and type checking passed.

### Changed from RFC

The built-in skill `customize-opencode`, left open in the RFC, now ranks as a built-in, so it can never hide a user's command. The warning does not show config file paths as planned, because the config loader merges all config folders without keeping each command's path.

### Remaining

Config file paths would require changes to the config loader. Clashes within a single source, such as two skills or two config folders, are not reported, and outside the TUI the warning is only a log line.

## Request 08 — Constantine An (constana)

Stop starting five language servers for one TypeScript file. (https://github.com/CMU-17695/opencode/issues/8)

### Change

Before this change, `.ts` files could match Deno, TypeScript, ESLint, Oxlint, and Biome, allowing multiple eligible servers to start. I added an optional `lspPreference` setting that starts at most one server per extension, for example `{ ".ts": "typescript" }`. Other extensions are not affected. One shared function in [`lsp/lsp.ts`](packages/opencode/src/lsp/lsp.ts) now chooses servers for `getClients()`, `ensureClients()`, and a new `opencode debug lsp explain <file>` command, which shows each server checked and why it started or was skipped. Without a preference, the existing behavior of starting eligible matching servers is preserved. If the preferred server cannot run, OpenCode falls back to the first other match that starts and logs a warning. `lsp: false` and the Python rule are unchanged.

### Checks and Results

In tests with five fake LSP servers on a `.repro` extension, a preference reduced startup from 5 processes to 1. A separate test confirms that the five built-in servers all claim `.ts` files. New tests in [`index.test.ts`](packages/opencode/test/lsp/index.test.ts) cover the old behavior, every fallback case, and the review cases (extension mismatch, unknown name, skipped linters). On the combined `main` (`c4633a1`), the LSP and config tests passed 119/0, and type checking passed in `packages/core` and `packages/opencode`.

### Changed from RFC

I log the fallback warning once per extension and server pair, not on every fallback. I also gave every server a reason in `explain`, which added a few labels, such as `preferred`, `fallback`, and `unknown-preference`. A spawn without a process ID now counts as a failure, so fallback happens in the same call.

### Remaining

Running TypeScript and ESLint together and an ordered backup list are deferred, so choosing `typescript` for `.ts` drops linter diagnostics. No memory saving has been measured on a real project.
