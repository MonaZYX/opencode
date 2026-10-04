import { expect, test } from "bun:test"
import { Schema } from "effect"
import { PermissionV1 } from "../src/v1/permission"

const request = {
  id: "per_test",
  sessionID: "ses_test",
  permission: "bash",
  patterns: ["npm --silent run test"],
  always: ["npm run test *"],
  metadata: {},
}

test("legacy permission requests need no command associations", () => {
  const decoded = Schema.decodeUnknownSync(PermissionV1.Request)(request)
  expect(Schema.encodeSync(PermissionV1.Request)({ ...decoded, commands: undefined })).toEqual(request)
})

test("raw and canonical associations survive permission request encoding", () => {
  const input = { ...request, commands: [{ raw: request.patterns[0], canonical: "npm run test" }] }
  const decoded = Schema.decodeUnknownSync(PermissionV1.Request)(input)
  expect(Schema.encodeSync(PermissionV1.Request)(decoded)).toEqual(input)
  expect(() => Schema.decodeUnknownSync(PermissionV1.Request)({ ...request, commands: [{ raw: "npm" }] })).toThrow()
})
