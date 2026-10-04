import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Format } from "../../src/format"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  Layer.mergeAll(
    LayerNode.compile(LayerNode.group([Format.node, CrossSpawnSpawner.node, FSUtil.node])),
    NodeFileSystem.layer,
  ),
)

const fail = [
  process.execPath,
  "-e",
  "require('fs').writeFileSync(process.argv[1], 'partial'); console.log('formatter explanation'); console.error('bad syntax'); process.exit(1)",
  "$FILE",
]
const succeed = [process.execPath, "-e", "require('fs').appendFileSync(process.argv[1], 'formatted')", "$FILE"]

describe("formatter outcomes and rollback", () => {
  for (const first of [false, true]) {
    it.instance(
      first ? "undoes a successful formatter when the second fails" : "stops after the first failure",
      () =>
        Effect.gen(function* () {
          const instance = yield* TestInstance
          const file = `${instance.directory}/test.failure`
          const bytes = Buffer.from("\uFEFFrequested\r\n")
          yield* Effect.promise(() => Bun.write(file, bytes))
          const result = yield* Format.use.file(file)
          expect(result.status).toBe("failed")
          expect(result.restoration).toBe("restored")
          expect(result.outcomes.map((item) => item.status)).toEqual(first ? ["success", "failed"] : ["failed"])
          expect(result.outcomes.at(-1)).toMatchObject({
            name: first ? "second" : "first",
            exitCode: 1,
            stdout: "formatter explanation\n",
            stderr: "bad syntax\n",
          })
          expect(Buffer.from(yield* Effect.promise(() => Bun.file(file).arrayBuffer()))).toEqual(bytes)
        }),
      {
        config: {
          formatter: {
            first: { extensions: [".failure"], command: first ? succeed : fail },
            second: { extensions: [".failure"], command: first ? fail : succeed },
          },
        },
      },
    )
  }

  it.instance(
    "reports a missing binary and preserves the edit",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const file = `${instance.directory}/test.missing`
        yield* Effect.promise(() => Bun.write(file, "requested"))
        const result = yield* Format.use.file(file)
        expect(result.status).toBe("failed")
        expect(result.restoration).toBe("restored")
        expect(result.outcomes[0]?.name).toBe("missing")
        expect(result.outcomes[0]?.error || result.outcomes[0]?.stderr).toBeTruthy()
        expect(Format.report(file, result)).toContain("Formatter missing failed")
        expect(yield* Effect.promise(() => Bun.file(file).text())).toBe("requested")
      }),
    {
      config: {
        formatter: { missing: { extensions: [".missing"], command: ["opencode-nonexistent-formatter-928471"] } },
      },
    },
  )

  for (const changes of [false, true]) {
    it.instance(
      changes ? "retains successful formatting" : "success does not imply changed bytes",
      () =>
        Effect.gen(function* () {
          const instance = yield* TestInstance
          const file = `${instance.directory}/test.success`
          yield* Effect.promise(() => Bun.write(file, "requested"))
          const result = yield* Format.use.file(file)
          expect(result.status).toBe("success")
          expect(result.outcomes[0]?.status).toBe("success")
          expect(Format.report(file, result)).toBe("")
          expect(yield* Effect.promise(() => Bun.file(file).text())).toBe(changes ? "requestedformatted" : "requested")
        }),
      {
        config: {
          formatter: {
            success: {
              extensions: [".success"],
              command: changes ? succeed : [process.execPath, "-e", "process.exit(0)"],
            },
          },
        },
      },
    )
  }

  it.instance(
    "does not run a formatter when the snapshot cannot be read",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const result = yield* Format.use.file(`${instance.directory}/absent.failure`)
        expect(result.status).toBe("failed")
        expect(result.outcomes).toEqual([])
        expect(result.snapshotError).toBeTruthy()
      }),
    { config: { formatter: { first: { extensions: [".failure"], command: fail } } } },
  )

  it.instance(
    "reports uncertain contents when restoration fails",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const file = `${instance.directory}/test.restore`
        yield* Effect.promise(() => Bun.write(file, "requested"))
        const result = yield* Format.use.file(file)
        expect(result.status).toBe("failed")
        expect(result.restoration).toBe("restore-failed")
        expect(result.restoreError).toBeTruthy()
        expect(Format.report(file, result)).toContain("Final contents are uncertain")
      }),
    {
      config: {
        formatter: {
          destructive: {
            extensions: [".restore"],
            command: [
              process.execPath,
              "-e",
              "const fs = require('fs'); fs.unlinkSync(process.argv[1]); fs.mkdirSync(process.argv[1]); process.exit(1)",
              "$FILE",
            ],
          },
        },
      },
    },
  )

  it.instance(
    "bounds and labels captured output",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const file = `${instance.directory}/test.large`
        yield* Effect.promise(() => Bun.write(file, "requested"))
        const result = yield* Format.use.file(file)
        expect(result.outcomes[0]?.stdout.length).toBe(65536)
        expect(result.outcomes[0]?.stderr.length).toBe(65536)
        expect(result.outcomes[0]?.stdoutTruncated).toBe(true)
        expect(result.outcomes[0]?.stderrTruncated).toBe(true)
        expect(Format.report(file, result)).toContain("stdout (truncated)")
      }),
    {
      config: {
        formatter: {
          large: {
            extensions: [".large"],
            command: [
              process.execPath,
              "-e",
              "require('fs').writeSync(1, 'x'.repeat(70000)); require('fs').writeSync(2, 'y'.repeat(70000)); process.exit(1)",
            ],
          },
        },
      },
    },
  )
})
