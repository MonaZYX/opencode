import { describe, expect, test } from "bun:test"
import { collisionMessage, merge, precedence, type Candidate, type Source } from "@/command"

const candidate = (source: Source, name: string): Candidate => ({
  source,
  origin: source === "skill" ? `/skills/${name}/SKILL.md` : source,
  command: {
    name,
    source: source === "skill" ? "skill" : source === "mcp" ? "mcp" : "command",
    template: source,
    hints: [],
  },
})

describe("command merge", () => {
  test("keeps every unique command in discovery order without warnings", () => {
    const result = merge([
      [candidate("built-in", "init"), candidate("built-in", "review")],
      [candidate("config", "custom")],
      [candidate("mcp", "server:prompt")],
      [candidate("skill", "local")],
    ])
    expect(Object.keys(result.commands)).toEqual(["init", "review", "custom", "server:prompt", "local"])
    expect(Object.values(result.commands).map((item) => item.source)).toEqual([
      "command",
      "command",
      "command",
      "mcp",
      "skill",
    ])
    expect(result.collisions).toEqual([])
  })

  test("config wins built-in, MCP, and skill collisions at the first discovered position", () => {
    const result = merge([
      [candidate("built-in", "review"), candidate("built-in", "init")],
      [candidate("mcp", "review")],
      [candidate("skill", "review")],
      [candidate("config", "review")],
    ])
    expect(Object.keys(result.commands)).toEqual(["review", "init"])
    expect(result.commands.review?.template).toBe("config")
    expect(result.collisions).toHaveLength(1)
    expect(result.collisions[0]?.hidden.map((item) => item.source)).toEqual(["skill", "mcp", "built-in"])
    expect(collisionMessage(result.collisions[0]!)).toContain("Using config review (config)")
    expect(collisionMessage(result.collisions[0]!)).toContain("skill review (/skills/review/SKILL.md)")
  })

  test("every source pair has the same winner in either discovery order", () => {
    for (const winner of precedence) {
      for (const loser of precedence.slice(precedence.indexOf(winner) + 1)) {
        for (const pair of [
          [winner, loser],
          [loser, winner],
        ] as const) {
          const result = merge(pair.map((source) => [candidate(source, "same")]))
          expect(result.collisions[0]?.winner.source).toBe(winner)
          expect(result.collisions[0]?.hidden.map((item) => item.source)).toEqual([loser])
        }
      }
    }
  })

  test("does not resolve a lazy MCP template while merging", () => {
    let reads = 0
    const prompt = candidate("mcp", "server:prompt")
    Object.defineProperty(prompt.command, "template", {
      get() {
        reads++
        return Promise.resolve("prompt")
      },
    })
    const result = merge([[prompt]])
    expect(reads).toBe(0)
    expect(result.commands["server:prompt"]).toBe(prompt.command)
  })
})
