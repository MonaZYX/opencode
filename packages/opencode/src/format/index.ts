import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer, Context, Schema } from "effect"
import { serviceUse } from "@opencode-ai/core/effect/service-use"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "@opencode-ai/core/process"
import { InstanceState } from "@/effect/instance-state"
import path from "path"
import { mergeDeep } from "remeda"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { errorMessage } from "@/util/error"
import * as Formatter from "./formatter"

export const Status = Schema.Struct({
  name: Schema.String,
  extensions: Schema.Array(Schema.String),
  enabled: Schema.Boolean,
}).annotate({ identifier: "FormatterStatus" })
export type Status = Schema.Schema.Type<typeof Status>

export interface Outcome {
  name: string
  status: "success" | "failed"
  exitCode?: number
  error?: string
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

export interface Result {
  status: "skipped" | "success" | "failed"
  outcomes: Outcome[]
  snapshotError?: string
  restoration?: "restored" | "restore-failed"
  restoreError?: string
}

export function report(filepath: string, result: Result): string {
  if (result.status !== "failed") return ""
  const details = result.outcomes
    .filter((item) => item.status === "failed")
    .map((item) =>
      [
        `Formatter ${item.name} failed${item.exitCode === undefined ? "" : ` (exit ${item.exitCode})`}.`,
        item.error,
        item.stdout && `stdout${item.stdoutTruncated ? " (truncated)" : ""}:\n${item.stdout}`,
        item.stderr && `stderr${item.stderrTruncated ? " (truncated)" : ""}:\n${item.stderr}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
  return `\n\nFormatting failed for ${filepath}.\n${[
    result.snapshotError && `Could not save the pre-format snapshot; no formatter ran: ${result.snapshotError}`,
    ...details,
    result.restoration === "restored" && "Restored the file to the requested edit before formatting.",
    result.restoreError && `Could not restore the file: ${result.restoreError}. Final contents are uncertain.`,
  ]
    .filter(Boolean)
    .join("\n")}`
}

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly status: () => Effect.Effect<Status[]>
  readonly file: (filepath: string) => Effect.Effect<Result>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Format") {}

export const use = serviceUse(Service)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const appProcess = yield* AppProcess.Service
    const flags = yield* RuntimeFlags.Service
    const fs = yield* FSUtil.Service

    const state = yield* InstanceState.make(
      Effect.fn("Format.state")(function* (ctx) {
        const commands: Record<string, string[] | false> = {}
        const formatters: Record<string, Formatter.Info> = {}

        async function getCommand(item: Formatter.Info) {
          let cmd = commands[item.name]
          if (cmd === false || cmd === undefined) {
            cmd = await item.enabled({ ...ctx, experimentalOxfmt: flags.experimentalOxfmt })
            commands[item.name] = cmd
          }
          return cmd
        }

        async function isEnabled(item: Formatter.Info) {
          const cmd = await getCommand(item)
          return cmd !== false
        }

        async function getFormatter(ext: string) {
          const matching = Object.values(formatters).filter((item) => item.extensions.includes(ext))
          const checks = await Promise.all(
            matching.map(async (item) => {
              const cmd = await getCommand(item)
              return {
                item,
                cmd,
              }
            }),
          )
          return checks
            .filter((x): x is { item: Formatter.Info; cmd: string[] } => x.cmd !== false)
            .map((x) => ({ item: x.item, cmd: x.cmd }))
        }

        function formatFile(filepath: string): Effect.Effect<Result> {
          return Effect.gen(function* () {
            const matching = yield* Effect.promise(() => getFormatter(path.extname(filepath)))
            if (!matching.length) return { status: "skipped", outcomes: [] }

            // Snapshot the tool's edit once, so a later failure also undoes earlier formatters.
            const snapshot = yield* fs.readFile(filepath).pipe(Effect.result)
            if (snapshot._tag === "Failure") {
              return { status: "failed", outcomes: [], snapshotError: errorMessage(snapshot.failure) }
            }
            const outcomes: Outcome[] = []
            const dir = yield* InstanceState.directory
            for (const entry of matching) {
              const replaced = entry.cmd.map((x) => x.replaceAll("$FILE", filepath))
              const result = yield* appProcess
                .run(
                  ChildProcess.make(replaced[0]!, replaced.slice(1), {
                    cwd: dir,
                    env: entry.item.environment,
                    extendEnv: true,
                    stdin: "ignore",
                    stdout: "pipe",
                    stderr: "pipe",
                  }),
                  { maxOutputBytes: 64 * 1024, maxErrorBytes: 64 * 1024 },
                )
                .pipe(Effect.result)
              const outcome: Outcome =
                result._tag === "Failure"
                  ? {
                      name: entry.item.name,
                      status: "failed",
                      error: errorMessage(result.failure.cause ?? result.failure),
                      exitCode: result.failure.exitCode,
                      stdout: "",
                      stderr: result.failure.stderr ?? "",
                      stdoutTruncated: false,
                      stderrTruncated: false,
                    }
                  : {
                      name: entry.item.name,
                      status: result.success.exitCode === 0 ? "success" : "failed",
                      exitCode: result.success.exitCode,
                      stdout: result.success.stdout.toString("utf8"),
                      stderr: result.success.stderr.toString("utf8"),
                      stdoutTruncated: result.success.stdoutTruncated,
                      stderrTruncated: result.success.stderrTruncated,
                    }
              outcomes.push(outcome)
              if (outcome.status === "success") continue
              const restored = yield* fs.writeFile(filepath, snapshot.success).pipe(Effect.result)
              return {
                status: "failed",
                outcomes,
                restoration: restored._tag === "Success" ? "restored" : "restore-failed",
                restoreError: restored._tag === "Failure" ? errorMessage(restored.failure) : undefined,
              }
            }
            return { status: "success", outcomes }
          })
        }

        const cfg = yield* config.get()

        if (!cfg.formatter) {
          yield* Effect.logInfo("all formatters are disabled")
          yield* Effect.logInfo("init")
          return {
            formatters,
            isEnabled,
            formatFile,
          }
        }

        for (const item of Object.values(Formatter)) {
          formatters[item.name] = item
        }

        if (cfg.formatter !== true) {
          for (const [name, item] of Object.entries(cfg.formatter)) {
            const builtIn = Formatter[name as keyof typeof Formatter]

            // Ruff and uv are both the same formatter, so disabling either should disable both.
            if (["ruff", "uv"].includes(name) && (cfg.formatter.ruff?.disabled || cfg.formatter.uv?.disabled)) {
              // TODO combine formatters so shared backends like Ruff/uv don't need linked disable handling here.
              delete formatters.ruff
              delete formatters.uv
              continue
            }
            if (item.disabled) {
              delete formatters[name]
              continue
            }
            const info = mergeDeep(builtIn ?? { extensions: [] }, item)

            formatters[name] = {
              ...info,
              name,
              extensions: info.extensions ?? [],
              enabled: builtIn && !info.command ? builtIn.enabled : async (_context) => info.command ?? false,
            }
          }
        }

        yield* Effect.logInfo("init")

        return {
          formatters,
          isEnabled,
          formatFile,
        }
      }),
    )

    const init = Effect.fn("Format.init")(function* () {
      yield* InstanceState.get(state)
    })

    const status = Effect.fn("Format.status")(function* () {
      const { formatters, isEnabled } = yield* InstanceState.get(state)
      const result: Status[] = []
      for (const formatter of Object.values(formatters)) {
        const isOn = yield* Effect.promise(() => isEnabled(formatter))
        result.push({
          name: formatter.name,
          extensions: formatter.extensions,
          enabled: isOn,
        })
      }
      return result
    })

    const file = Effect.fn("Format.file")(function* (filepath: string) {
      const { formatFile } = yield* InstanceState.get(state)
      return yield* formatFile(filepath)
    })

    return Service.of({ init, status, file })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Config.node, AppProcess.node, RuntimeFlags.node, FSUtil.node],
})

export * as Format from "."
