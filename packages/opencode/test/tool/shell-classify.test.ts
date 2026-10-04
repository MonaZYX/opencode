import { expect, test } from "bun:test"
import { classify } from "../../src/tool/shell/classify"
import { BashArity } from "../../src/permission/arity"

test("supported placement has one Always pattern without widening arity", () => {
  const commands = ["npm --silent run test", "npm run --silent test", "npm run test --silent"]
  const patterns = commands.map((raw) => BashArity.prefix(classify(raw.split(" "))!).join(" ") + " *")
  expect(patterns).toEqual(Array(3).fill("npm run test *"))
  expect(classify(["npm", "run", "dev", "--silent"])).toEqual(["npm", "run", "dev"])
  expect(classify(["git", "-C", "/tmp", "status"])).toEqual(["git", "status"])
  expect(classify(["docker", "compose", "-f", "x.yml", "up"])).toEqual(["docker", "compose", "up"])
})

test("ambiguous, unknown, flags-only and shell syntax retain fallback", () => {
  for (const raw of [
    "unknown --silent run test",
    "npm --unknown run test",
    "npm --silent",
    "git -C",
    "git -C --help status",
    "npm run -- test",
    "npm run $SCRIPT",
    "npm run 'test'",
    "docker -f x.yml compose up",
    "rm -rf foo",
  ]) {
    expect(classify(raw.split(" "))).toBeUndefined()
  }
})
