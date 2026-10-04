import { describe, expect, spyOn } from "bun:test"
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Layer, Logger } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { LSP } from "@/lsp/lsp"
import * as LSPServer from "@/lsp/server"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { TestInstance } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const lspLayer = (flags: Parameters<typeof RuntimeFlags.layer>[0] = {}) =>
  LayerNode.compile(LayerNode.group([LSP.node, Config.node, RuntimeFlags.node, EventV2Bridge.node]), [
    [RuntimeFlags.node, RuntimeFlags.layer(flags)],
  ])

const it = testEffect(Layer.mergeAll(lspLayer(), LayerNode.compile(CrossSpawnSpawner.node)))
const experimentalTyIt = testEffect(
  Layer.mergeAll(lspLayer({ experimentalLspTy: true }), LayerNode.compile(CrossSpawnSpawner.node)),
)
const fakeServerPath = path.join(__dirname, "../fixture/lsp/fake-lsp-server.js")
const disabledDownloadIt = testEffect(
  Layer.mergeAll(lspLayer({ disableLspDownload: true }), LayerNode.compile(CrossSpawnSpawner.node)),
)

describe("lsp.spawn", () => {
  it.instance(
    "does not spawn builtin LSP for files outside instance",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.touchFile(path.join(dir, "..", "outside.ts"))
            yield* lsp.hover({
              file: path.join(dir, "..", "hover.ts"),
              line: 0,
              character: 0,
            })
            expect(spy).toHaveBeenCalledTimes(0)
          } finally {
            spy.mockRestore()
          }
        }),
      ),
    { config: { lsp: true } },
  )

  it.instance("does not spawn builtin LSP for files inside instance when LSP is unset", () =>
    LSP.Service.use((lsp) =>
      Effect.gen(function* () {
        const dir = (yield* TestInstance).directory
        const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

        try {
          yield* lsp.hover({
            file: path.join(dir, "src", "inside.ts"),
            line: 0,
            character: 0,
          })
          expect(spy).toHaveBeenCalledTimes(0)
        } finally {
          spy.mockRestore()
        }
      }),
    ),
  )

  it.instance(
    "would spawn builtin LSP for files inside instance when lsp is true",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.hover({
              file: path.join(dir, "src", "inside.ts"),
              line: 0,
              character: 0,
            })
            expect(spy).toHaveBeenCalledTimes(1)
          } finally {
            spy.mockRestore()
          }
        }),
      ),
    { config: { lsp: true } },
  )

  it.instance(
    "publishes lsp.updated after custom LSP initialization",
    () =>
      Effect.gen(function* () {
        const dir = (yield* TestInstance).directory
        const lsp = yield* LSP.Service
        const updated = yield* Deferred.make<void>()
        const events = yield* EventV2Bridge.Service
        const unsubscribe = yield* events.listen((event) => {
          if (event.type === LSP.Event.Updated.type) Deferred.doneUnsafe(updated, Effect.void)
          return Effect.void
        })
        yield* Effect.addFinalizer(() => unsubscribe)

        const file = path.join(dir, "sample.repro")
        yield* Effect.promise(() => Bun.write(file, "sample\n"))
        yield* lsp.touchFile(file)
        yield* awaitWithTimeout(Deferred.await(updated), "lsp.updated event was not published")
      }),
    {
      config: {
        lsp: {
          fake: {
            command: [process.execPath, fakeServerPath],
            extensions: [".repro"],
          },
        },
      },
    },
  )

  it.instance(
    "would spawn builtin LSP for files inside instance when config object is provided",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.hover({
              file: path.join(dir, "src", "inside.ts"),
              line: 0,
              character: 0,
            })
            expect(spy).toHaveBeenCalledTimes(1)
          } finally {
            spy.mockRestore()
          }
        }),
      ),
    {
      config: {
        lsp: {
          eslint: { disabled: true },
        },
      },
    },
  )

  it.instance(
    "uses pyright instead of ty by default",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const ty = spyOn(LSPServer.Ty, "spawn").mockResolvedValue(undefined)
          const pyright = spyOn(LSPServer.Pyright, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.hover({
              file: path.join(dir, "src", "inside.py"),
              line: 0,
              character: 0,
            })
            expect(ty).toHaveBeenCalledTimes(0)
            expect(pyright).toHaveBeenCalledTimes(1)
          } finally {
            ty.mockRestore()
            pyright.mockRestore()
          }
        }),
      ),
    { config: { lsp: true } },
  )

  experimentalTyIt.instance(
    "uses ty instead of pyright when experimentalLspTy is enabled",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const ty = spyOn(LSPServer.Ty, "spawn").mockResolvedValue(undefined)
          const pyright = spyOn(LSPServer.Pyright, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.hover({
              file: path.join(dir, "src", "inside.py"),
              line: 0,
              character: 0,
            })
            expect(ty).toHaveBeenCalledTimes(1)
            expect(pyright).toHaveBeenCalledTimes(0)
          } finally {
            ty.mockRestore()
            pyright.mockRestore()
          }
        }),
      ),
    { config: { lsp: true } },
  )

  disabledDownloadIt.instance(
    "passes disableLspDownload to builtin LSP spawn",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const pyright = spyOn(LSPServer.Pyright, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.hover({
              file: path.join(dir, "src", "inside.py"),
              line: 0,
              character: 0,
            })
            expect(pyright).toHaveBeenCalledTimes(1)
            expect(pyright.mock.calls[0]?.[2]).toMatchObject({ disableLspDownload: true })
          } finally {
            pyright.mockRestore()
          }
        }),
      ),
    { config: { lsp: true } },
  )
})

describe("lsp selection", () => {
  const fake = { command: [process.execPath, fakeServerPath], extensions: [".repro"] }

  it.instance(
    "considers the five built-in servers that claim TypeScript files",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const servers = [LSPServer.Deno, LSPServer.Typescript, LSPServer.ESLint, LSPServer.Oxlint, LSPServer.Biome]
          const spies = servers.map((server) => spyOn(server, "spawn").mockResolvedValue(undefined))
          try {
            const file = path.join((yield* TestInstance).directory, "sample.ts")
            const explanation = yield* lsp.explain(file)
            expect(explanation.decisions.map((decision) => decision.id).sort()).toEqual([
              "biome",
              "deno",
              "eslint",
              "oxlint",
              "typescript",
            ])
          } finally {
            spies.forEach((spy) => spy.mockRestore())
          }
        }),
      ),
    { config: { lsp: true } },
  )

  it.instance(
    "starts every matching server without a preference",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const file = path.join((yield* TestInstance).directory, "sample.repro")
          const explanation = yield* lsp.explain(file)
          expect(explanation.decisions.filter((decision) => decision.started).map((decision) => decision.id)).toEqual([
            "first",
            "second",
            "third",
            "fourth",
            "fifth",
          ])
          expect(explanation.decisions.every((decision) => decision.reason === "default")).toBe(true)
          expect((yield* lsp.status()).length).toBe(5)
          expect(yield* lsp.ensureClients(file)).toBe(true)
        }),
      ),
    { config: { lsp: { first: fake, second: fake, third: fake, fourth: fake, fifth: fake } } },
  )

  it.instance(
    "starts only the preferred server and leaves other extensions available",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const dir = (yield* TestInstance).directory
          const explanation = yield* lsp.explain(path.join(dir, "sample.repro"))
          expect(explanation.decisions.find((decision) => decision.id === "first")).toMatchObject({
            selected: true,
            started: true,
            reason: "preferred",
          })
          expect(explanation.decisions.find((decision) => decision.id === "second")).toMatchObject({
            selected: false,
            started: false,
            reason: "not-preferred",
          })
          expect(explanation.decisions.filter((decision) => decision.started).map((decision) => decision.id)).toEqual([
            "first",
          ])
          expect((yield* lsp.status()).map((item) => item.id)).toEqual(["first"])
          const other = yield* lsp.explain(path.join(dir, "sample.other"))
          expect(other.decisions.find((decision) => decision.id === "second")?.started).toBe(true)
        }),
      ),
    {
      config: {
        lsp: {
          first: fake,
          second: { ...fake, extensions: [".repro", ".other"] },
          third: fake,
          fourth: fake,
          fifth: fake,
        },
        lspPreference: { ".repro": "first" },
      },
    },
  )

  it.instance(
    "falls back when the preferred server is disabled",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const file = path.join((yield* TestInstance).directory, "sample.repro")
          const messages: unknown[] = []
          const explanation = yield* lsp
            .explain(file)
            .pipe(
              Effect.provide(Logger.layer([Logger.make<unknown, void>((options) => messages.push(options.message))])),
            )
          expect(explanation.decisions.find((decision) => decision.id === "first")).toMatchObject({
            selected: false,
            started: false,
            reason: "disabled",
          })
          expect(explanation.decisions.find((decision) => decision.id === "second")).toMatchObject({
            selected: true,
            started: true,
            reason: "fallback",
          })
          expect(explanation.decisions.find((decision) => decision.id === "third")).toMatchObject({
            selected: false,
            started: false,
            reason: "not-preferred",
          })
          expect(messages).toContainEqual([
            "preferred LSP unavailable; fallback server may offer different features",
            expect.objectContaining({ extension: ".repro", preferred: "first", fallback: "second" }),
          ])
          expect(yield* lsp.ensureClients(file)).toBe(true)
        }),
      ),
    {
      config: {
        lsp: { first: { disabled: true }, second: fake, third: fake },
        lspPreference: { ".repro": "first" },
      },
    },
  )

  it.instance(
    "reports an unknown preference and uses one matching server",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const file = path.join((yield* TestInstance).directory, "sample.repro")
          const messages: unknown[] = []
          const explanation = yield* lsp
            .explain(file)
            .pipe(
              Effect.provide(Logger.layer([Logger.make<unknown, void>((options) => messages.push(options.message))])),
            )
          expect(explanation.decisions.find((decision) => decision.id === "typo")).toMatchObject({
            started: false,
            reason: "unknown-preference",
          })
          expect(explanation.decisions.filter((decision) => decision.started).map((decision) => decision.id)).toEqual([
            "first",
          ])
          expect(messages).toContainEqual(["unknown preferred LSP server", { extension: ".repro", serverID: "typo" }])
          expect(messages).toContainEqual([
            "preferred LSP unavailable; fallback server may offer different features",
            { extension: ".repro", preferred: "typo", fallback: "first" },
          ])
          expect(yield* lsp.ensureClients(file)).toBe(true)
          expect((yield* lsp.status()).map((client) => client.id)).toEqual(["first"])
        }),
      ),
    {
      config: { lsp: { first: fake, second: fake }, lspPreference: { ".repro": "typo" } },
    },
  )

  it.instance(
    "warns and falls back once when a preferred server does not support the extension",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const file = path.join((yield* TestInstance).directory, "sample.repro")
          const messages: unknown[] = []
          const explanation = yield* Effect.gen(function* () {
            expect(yield* lsp.ensureClients(file)).toBe(true)
            return yield* lsp.explain(file)
          }).pipe(
            Effect.provide(Logger.layer([Logger.make<unknown, void>((options) => messages.push(options.message))])),
          )
          expect(explanation.decisions.find((decision) => decision.id === "first")).toMatchObject({
            selected: false,
            started: false,
            reason: "extension-mismatch",
          })
          expect(explanation.decisions.find((decision) => decision.id === "second")).toMatchObject({
            selected: true,
            started: true,
            reason: "fallback",
          })
          expect(explanation.decisions.find((decision) => decision.id === "third")).toMatchObject({
            selected: false,
            started: false,
            reason: "not-preferred",
          })
          expect((yield* lsp.status()).map((client) => client.id)).toEqual(["second"])
          expect(
            messages.filter(
              (message) =>
                Array.isArray(message) &&
                message[0] === "preferred LSP unavailable; fallback server may offer different features",
            ),
          ).toEqual([
            [
              "preferred LSP unavailable; fallback server may offer different features",
              { extension: ".repro", preferred: "first", fallback: "second" },
            ],
          ])
        }),
      ),
    {
      config: {
        lsp: { first: { ...fake, extensions: [".other"] }, second: fake, third: fake },
        lspPreference: { ".repro": "first" },
      },
    },
  )

  it.instance(
    "reuses the preferred TypeScript client and reports matching linters as not preferred",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const file = path.join((yield* TestInstance).directory, "sample.ts")
          yield* Effect.promise(() => Bun.write(file, "const answer = 42\n"))
          expect(yield* lsp.ensureClients(file)).toBe(true)
          yield* lsp.touchFile(file)
          const explanation = yield* lsp.explain(file)
          expect(explanation.decisions.find((decision) => decision.id === "typescript")).toMatchObject({
            selected: true,
            started: true,
            reason: "preferred",
          })
          for (const id of ["eslint", "oxlint", "biome"]) {
            expect(explanation.decisions.find((decision) => decision.id === id)).toMatchObject({
              selected: false,
              started: false,
              reason: "not-preferred",
            })
          }
          expect((yield* lsp.status()).map((client) => client.id)).toEqual(["typescript"])
        }),
      ),
    {
      config: {
        lsp: {
          typescript: { ...fake, extensions: [".ts"] },
          eslint: { ...fake, extensions: [".ts"] },
          oxlint: { ...fake, extensions: [".ts"] },
          biome: { ...fake, extensions: [".ts"] },
        },
        lspPreference: { ".ts": "typescript" },
      },
    },
  )

  it.instance(
    "falls back when the preferred server has no project root",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const file = path.join((yield* TestInstance).directory, "sample.ts")
          const explanation = yield* lsp.explain(file)
          expect(explanation.decisions.find((decision) => decision.id === "deno")).toMatchObject({
            started: false,
            reason: "no-root",
          })
          expect(explanation.decisions.filter((decision) => decision.started).map((decision) => decision.id)).toEqual([
            "typescript",
          ])
          expect(yield* lsp.ensureClients(file)).toBe(true)
        }),
      ),
    {
      config: {
        lsp: { typescript: { ...fake, extensions: [".ts"] } },
        lspPreference: { ".ts": "deno" },
      },
    },
  )

  it.instance(
    "falls back when the preferred executable does not exist",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const file = path.join((yield* TestInstance).directory, "sample.repro")
          const explanation = yield* lsp.explain(file)
          expect(explanation.decisions.find((decision) => decision.id === "first")).toMatchObject({
            started: false,
            reason: "spawn-failed",
          })
          expect(explanation.decisions.find((decision) => decision.id === "second")).toMatchObject({
            started: true,
            reason: "fallback",
          })
          expect(yield* lsp.ensureClients(file)).toBe(true)
          expect((yield* lsp.status()).map((client) => client.id)).toEqual(["second"])
        }),
      ),
    {
      config: {
        lsp: {
          first: { command: ["opencode-nonexistent-lsp-for-test"], extensions: [".repro"] },
          second: fake,
          third: fake,
        },
        lspPreference: { ".repro": "first" },
      },
    },
  )

  it.instance(
    "returns no clients or diagnostics when the preferred server and every fallback fail",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const file = path.join((yield* TestInstance).directory, "sample.repro")
          const explanation = yield* lsp.explain(file)
          expect(explanation.decisions.filter((decision) => decision.started)).toEqual([])
          expect(explanation.decisions.every((decision) => decision.reason === "spawn-failed")).toBe(true)
          expect(yield* lsp.ensureClients(file)).toBe(false)
          yield* lsp.touchFile(file)
          expect(yield* lsp.status()).toEqual([])
          expect(yield* lsp.diagnostics()).toEqual({})
        }),
      ),
    {
      config: {
        lsp: {
          first: { command: ["opencode-nonexistent-lsp-for-test"], extensions: [".repro"] },
          second: { command: ["opencode-nonexistent-lsp-for-test"], extensions: [".repro"] },
        },
        lspPreference: { ".repro": "first" },
      },
    },
  )

  it.instance(
    "ignores preferences when LSP is disabled",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const file = path.join((yield* TestInstance).directory, "sample.repro")
          expect(yield* lsp.ensureClients(file)).toBe(false)
          expect((yield* lsp.explain(file)).decisions).toEqual([])
        }),
      ),
    { config: { lsp: false, lspPreference: { ".repro": "first" } } },
  )

  it.instance(
    "falls back in the same call when the preferred server fails to start",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const file = path.join((yield* TestInstance).directory, "sample.ts")
          const typescript = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)
          try {
            const explanation = yield* lsp.explain(file)
            expect(explanation.decisions.find((decision) => decision.id === "typescript")).toMatchObject({
              selected: true,
              started: false,
              reason: "spawn-failed",
            })
            expect(explanation.decisions.find((decision) => decision.id === "fallback")).toMatchObject({
              selected: true,
              started: true,
              reason: "fallback",
            })
            expect(yield* lsp.ensureClients(file)).toBe(true)
          } finally {
            typescript.mockRestore()
          }
        }),
      ),
    {
      config: {
        lsp: { fallback: { ...fake, extensions: [".ts"] } },
        lspPreference: { ".ts": "typescript" },
      },
    },
  )

  it.instance(
    "returns empty diagnostics for an unmatched file",
    () =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const file = path.join((yield* TestInstance).directory, "sample.no-lsp")
          yield* lsp.touchFile(file)
          expect(yield* lsp.ensureClients(file)).toBe(false)
          expect((yield* lsp.explain(file)).decisions).toEqual([])
          expect(yield* lsp.diagnostics()).toEqual({})
        }),
      ),
    { config: { lsp: true } },
  )
})
