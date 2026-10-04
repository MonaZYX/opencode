import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { MCP } from "@/mcp"
import { Skill } from "@/skill"
import { EventV2Bridge } from "@/event-v2-bridge"
import { TuiEvent } from "@/server/tui-event"
import { Event } from "@opencode-ai/schema/event"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { testInstanceStoreLayer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const layer = Layer.mergeAll(
  LayerNode.compile(Command.node, [
    [
      Config.node,
      Layer.mock(Config.Service, {
        get: () => Effect.succeed({ command: { custom: { template: "configured" } } } as ConfigV1.Info),
      }),
    ],
    [
      MCP.node,
      Layer.mock(MCP.Service, {
        prompts: () => Effect.succeed({ "server:prompt": { client: "server", name: "prompt" } }),
      }),
    ],
    [
      Skill.node,
      Layer.mock(Skill.Service, {
        all: () =>
          Effect.succeed([
            {
              name: "local-skill",
              description: "Local skill",
              location: "/skills/local-skill/SKILL.md",
              content: "local skill content",
            },
          ]),
      }),
    ],
  ]),
  testInstanceStoreLayer,
)

const it = testEffect(layer)

it.instance("lists commands from every source without clashes in discovery order", () =>
  Effect.gen(function* () {
    const command = yield* Command.Service
    const list = yield* command.list()
    expect(list.map(({ name, source }) => ({ name, source }))).toEqual([
      { name: "init", source: "command" },
      { name: "review", source: "command" },
      { name: "custom", source: "command" },
      { name: "server:prompt", source: "mcp" },
      { name: "local-skill", source: "skill" },
    ])
  }),
)

function warningCase(clash: boolean) {
  const published: { type: string; data: unknown }[] = []
  const eventLayer = Layer.mock(EventV2Bridge.Service, {
    publish: (definition, data) =>
      Effect.sync(() => {
        published.push({ type: definition.type, data })
        return { id: Event.ID.create(), type: definition.type, data }
      }),
  })
  const commandLayer = Layer.mergeAll(
    LayerNode.compile(Command.node, [
      [
        Config.node,
        Layer.mock(Config.Service, {
          get: () =>
            Effect.succeed(
              (clash ? { command: { review: { template: "configured review" } } } : { command: {} }) as ConfigV1.Info,
            ),
        }),
      ],
      [MCP.node, Layer.mock(MCP.Service, { prompts: () => Effect.succeed({}) })],
      [Skill.node, Layer.mock(Skill.Service, { all: () => Effect.succeed([]) })],
      [EventV2Bridge.node, eventLayer],
    ]),
    testInstanceStoreLayer,
  )
  return { it: testEffect(commandLayer), published }
}

const duplicate = warningCase(true)
duplicate.it.instance("publishes one toast and records one config/built-in collision", () =>
  Effect.gen(function* () {
    const command = yield* Command.Service
    expect((yield* command.list()).map((item) => item.name)).toEqual(["init", "review"])
    const collisions = yield* command.collisions()
    expect(collisions).toHaveLength(1)
    expect(collisions[0]?.name).toBe("review")
    expect(collisions[0]?.winner.source).toBe("config")
    expect(collisions[0]?.hidden.map((item) => item.source)).toEqual(["built-in"])
    expect(duplicate.published).toEqual([
      {
        type: TuiEvent.ToastShow.type,
        data: {
          title: "Duplicate command",
          message: "/review is defined more than once. Using config /review. Hidden: built-in /review.",
          variant: "warning",
          duration: 8000,
        },
      },
    ])
  }),
)

const unique = warningCase(false)
unique.it.instance("publishes no toast and records no collision without a clash", () =>
  Effect.gen(function* () {
    const command = yield* Command.Service
    yield* command.list()
    expect(yield* command.collisions()).toEqual([])
    expect(unique.published).toEqual([])
  }),
)
