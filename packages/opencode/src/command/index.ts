import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import type { InstanceContext } from "@/project/instance-context"
import { Effect, Layer, Context, Schema } from "effect"
import { Config } from "@/config/config"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"
import { LegacyEvent } from "@opencode-ai/schema/legacy-event"
import { EventV2Bridge } from "@/event-v2-bridge"
import { TuiEvent } from "@/server/tui-event"

type State = {
  commands: Record<string, Info>
  collisions: Collision[]
}

export type Source = "config" | "skill" | "mcp" | "built-in"
export type Candidate = { command: Info; source: Source; origin: string }
export type Collision = { name: string; winner: Candidate; hidden: Candidate[] }

// Source priority is independent of discovery order. Replacing a value in a Map
// preserves the name's original position in the command palette.
export const precedence: readonly Source[] = ["config", "skill", "mcp", "built-in"]

export function merge(groups: readonly (readonly Candidate[])[]) {
  const found = new Map<string, Candidate[]>()
  for (const group of groups) {
    for (const candidate of group) {
      const previous = found.get(candidate.command.name) ?? []
      found.set(candidate.command.name, [...previous, candidate])
    }
  }
  const commands: Record<string, Info> = {}
  const collisions: Collision[] = []
  for (const [name, candidates] of found) {
    const ranked = [...candidates].sort((a, b) => precedence.indexOf(a.source) - precedence.indexOf(b.source))
    const winner = ranked[0]!
    commands[name] = winner.command
    if (ranked.length > 1) collisions.push({ name, winner, hidden: ranked.slice(1) })
  }
  return { commands, collisions }
}

export function collisionMessage(collision: Collision) {
  const label = (candidate: Candidate) =>
    `${candidate.source} /${candidate.command.name}${candidate.origin === candidate.source ? "" : ` (${candidate.origin})`}`
  return `/${collision.name} is defined more than once. Using ${label(collision.winner)}. Hidden: ${collision.hidden.map(label).join(", ")}.`
}

export const Event = {
  Executed: LegacyEvent.CommandExecuted,
}

export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  source: Schema.optional(Schema.Literals(["command", "mcp", "skill"])),
  // Some command templates are lazy promises from MCP prompt resolution.
  template: Schema.Unknown,
  subtask: Schema.optional(Schema.Boolean),
  hints: Schema.Array(Schema.String),
}).annotate({ identifier: "Command" })

export type Info = Omit<Schema.Schema.Type<typeof Info>, "template"> & { template: Promise<string> | string }

export function hints(template: string) {
  const result: string[] = []
  const numbered = template.match(/\$\d+/g)
  if (numbered) {
    for (const match of [...new Set(numbered)].sort()) result.push(match)
  }
  if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
  return result
}

export const Default = {
  INIT: "init",
  REVIEW: "review",
} as const

export interface Interface {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
  readonly collisions: () => Effect.Effect<Collision[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Command") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const mcp = yield* MCP.Service
    const skill = yield* Skill.Service
    const events = yield* EventV2Bridge.Service

    const init = Effect.fn("Command.state")(function* (ctx: InstanceContext) {
      const cfg = yield* config.get()
      const bridge = yield* EffectBridge.make()
      const builtins: Candidate[] = []
      const configured: Candidate[] = []
      const prompts: Candidate[] = []
      const skills: Candidate[] = []

      const loadBuiltins = () => {
        builtins.push({
          source: "built-in",
          origin: "built-in",
          command: {
            name: Default.INIT,
            description: "guided AGENTS.md setup",
            source: "command",
            get template() {
              return PROMPT_INITIALIZE.replace("${path}", ctx.worktree)
            },
            hints: hints(PROMPT_INITIALIZE),
          },
        })
        builtins.push({
          source: "built-in",
          origin: "built-in",
          command: {
            name: Default.REVIEW,
            description: "review changes [commit|branch|pr], defaults to uncommitted",
            source: "command",
            get template() {
              return PROMPT_REVIEW.replace("${path}", ctx.worktree)
            },
            subtask: true,
            hints: hints(PROMPT_REVIEW),
          },
        })
      }

      const loadConfig = () => {
        for (const [name, command] of Object.entries(cfg.command ?? {})) {
          configured.push({
            source: "config",
            origin: "config",
            command: {
              name,
              agent: command.agent,
              model: command.model,
              description: command.description,
              source: "command",
              get template() {
                return command.template
              },
              subtask: command.subtask,
              hints: hints(command.template),
            },
          })
        }
      }

      const loadMcp = (
        items: Awaited<ReturnType<typeof mcp.prompts>> extends Effect.Effect<infer A, any, any> ? A : never,
      ) => {
        for (const [name, prompt] of Object.entries(items)) {
          prompts.push({
            source: "mcp",
            origin: prompt.client,
            command: {
              name,
              source: "mcp",
              description: prompt.description,
              get template() {
                return bridge.promise(
                  mcp
                    .getPrompt(
                      prompt.client,
                      prompt.name,
                      prompt.arguments
                        ? Object.fromEntries(prompt.arguments.map((argument, i) => [argument.name, `$${i + 1}`]))
                        : {},
                    )
                    .pipe(
                      Effect.map(
                        (template) =>
                          template?.messages
                            .map((message) => (message.content.type === "text" ? message.content.text : ""))
                            .join("\n") || "",
                      ),
                    ),
                )
              },
              hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
            },
          })
        }
      }

      const loadSkills = (
        items: Awaited<ReturnType<typeof skill.all>> extends Effect.Effect<infer A, any, any> ? A : never,
      ) => {
        for (const item of items) {
          const dir = item.location === "<built-in>" ? undefined : path.dirname(item.location)
          skills.push({
            source: item.location === "<built-in>" ? "built-in" : "skill",
            origin: item.location,
            command: {
              name: item.name,
              description: item.description,
              source: "skill",
              get template() {
                if (!dir) return item.content
                return [
                  item.content,
                  "",
                  `Base directory for this skill: ${dir}`,
                  "Relative paths in this skill (e.g., scripts/, references/) are relative to this base directory.",
                ].join("\n")
              },
              hints: [],
            },
          })
        }
      }

      loadBuiltins()
      loadConfig()
      loadMcp(yield* mcp.prompts())
      loadSkills(yield* skill.all())
      const result = merge([builtins, configured, prompts, skills])
      for (const collision of result.collisions) {
        const message = collisionMessage(collision)
        yield* Effect.logWarning(message)
        yield* events
          .publish(TuiEvent.ToastShow, {
            title: "Duplicate command",
            message,
            variant: "warning",
            duration: 8000,
          })
          .pipe(Effect.ignore)
      }

      return result
    })

    const state = yield* InstanceState.make<State>((ctx) => init(ctx))

    const get = Effect.fn("Command.get")(function* (name: string) {
      const s = yield* InstanceState.get(state)
      return s.commands[name]
    })

    const list = Effect.fn("Command.list")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.commands)
    })

    const collisions = Effect.fn("Command.collisions")(function* () {
      const s = yield* InstanceState.get(state)
      return s.collisions
    })

    return Service.of({ get, list, collisions })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Config.node, MCP.node, Skill.node, EventV2Bridge.node],
})

export * as Command from "."
