import { describe, expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Format } from "../../src/format"
import { LSP } from "../../src/lsp/lsp"
import { Agent } from "../../src/agent/agent"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Truncate } from "../../src/tool/truncate"
import { WriteTool } from "../../src/tool/write"
import { EditTool } from "../../src/tool/edit"
import { ApplyPatchTool } from "../../src/tool/apply_patch"
import { SessionID, MessageID } from "../../src/session/schema"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      LSP.node,
      FSUtil.node,
      Format.node,
      EventV2Bridge.node,
      Truncate.node,
      Agent.node,
      CrossSpawnSpawner.node,
    ]),
  ),
)

const ctx = {
  sessionID: SessionID.make("ses_formatter_failure"),
  messageID: MessageID.make("msg_formatter_failure"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const config = {
  formatter: {
    failing: {
      extensions: [".fmtfailure"],
      command: [
        process.execPath,
        "-e",
        "require('fs').writeFileSync(process.argv[1], 'broken'); console.error('formatting explanation'); process.exit(1)",
        "$FILE",
      ],
    },
  },
}

describe("tool formatter failure reporting", () => {
  it.instance(
    "write, both edit paths, and patch report identical failures",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const fs = yield* FSUtil.Service
        const filepath = path.join(instance.directory, "same.fmtfailure")
        const writeInfo = yield* WriteTool
        const editInfo = yield* EditTool
        const patchInfo = yield* ApplyPatchTool
        const write = yield* writeInfo.init()
        const edit = yield* editInfo.init()
        const patch = yield* patchInfo.init()

        const written = yield* write.execute({ filePath: filepath, content: "requested\n" }, ctx)
        expect(yield* fs.readFileString(filepath)).toBe("requested\n")
        const edited = yield* edit.execute({ filePath: filepath, oldString: "requested", newString: "edited" }, ctx)
        expect(yield* fs.readFileString(filepath)).toBe("edited\n")
        expect(edited.metadata.diff).toContain("+edited")
        expect(edited.metadata.diff).not.toContain("broken")
        yield* fs.remove(filepath)
        const created = yield* edit.execute({ filePath: filepath, oldString: "", newString: "created\n" }, ctx)
        expect(yield* fs.readFileString(filepath)).toBe("created\n")
        const patched = yield* patch.execute(
          { patchText: "*** Begin Patch\n*** Update File: same.fmtfailure\n@@\n-created\n+patched\n*** End Patch" },
          ctx,
        )
        expect(yield* fs.readFileString(filepath)).toBe("patched\n")
        const details = [written, edited, created, patched].map((result) =>
          result.output.slice(result.output.indexOf("\n\nFormatting failed")),
        )
        expect(details.every((detail) => detail === details[0])).toBe(true)
        expect(details[0]).toContain("Formatter failing failed (exit 1)")
        expect(details[0]).toContain("formatting explanation")
        expect(patched.title).not.toContain("formatting explanation")
      }),
    { config },
  )

  it.instance(
    "patch reports moved targets and does not format deletions",
    () =>
      Effect.gen(function* () {
        const instance = yield* TestInstance
        const fs = yield* FSUtil.Service
        yield* fs.writeFileString(`${instance.directory}/old.fmtfailure`, "old\n")
        const info = yield* ApplyPatchTool
        const patch = yield* info.init()
        const moved = yield* patch.execute(
          {
            patchText:
              "*** Begin Patch\n*** Update File: old.fmtfailure\n*** Move to: moved.fmtfailure\n@@\n-old\n+new\n*** End Patch",
          },
          ctx,
        )
        expect(moved.output).toContain(`Formatting failed for ${path.join(instance.directory, "moved.fmtfailure")}`)
        expect(yield* fs.readFileString(`${instance.directory}/moved.fmtfailure`)).toBe("new\n")
        const deleted = yield* patch.execute(
          { patchText: "*** Begin Patch\n*** Delete File: moved.fmtfailure\n*** End Patch" },
          ctx,
        )
        expect(deleted.output).not.toContain("Formatting failed")
      }),
    { config },
  )
})
