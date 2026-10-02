import { LSP } from "@/lsp/lsp"
import { Effect } from "effect"
import { effectCmd } from "../../effect-cmd"
import { cmd } from "../cmd"
import { EOL } from "os"
import path from "path"
import { InstanceState } from "@/effect/instance-state"

export const LSPCommand = cmd({
  command: "lsp",
  describe: "LSP debugging utilities",
  builder: (yargs) =>
    yargs
      .command(DiagnosticsCommand)
      .command(ExplainCommand)
      .command(SymbolsCommand)
      .command(DocumentSymbolsCommand)
      .demandCommand(),
  async handler() {},
})

const DiagnosticsCommand = effectCmd({
  command: "diagnostics <file>",
  describe: "get diagnostics for a file",
  builder: (yargs) => yargs.positional("file", { type: "string", demandOption: true }),
  handler: Effect.fn("Cli.debug.lsp.diagnostics")(function* (args) {
    const out = yield* LSP.Service.use((lsp) =>
      Effect.gen(function* () {
        yield* lsp.touchFile(args.file, "full")
        return yield* lsp.diagnostics()
      }),
    )
    process.stdout.write(JSON.stringify(out, null, 2) + EOL)
  }),
})

const ExplainCommand = effectCmd({
  command: "explain <file>",
  describe: "show LSP selection and startup decisions for a file",
  builder: (yargs) => yargs.positional("file", { type: "string", demandOption: true }),
  handler: Effect.fn("Cli.debug.lsp.explain")(function* (args) {
    const ctx = yield* InstanceState.context
    const file = path.isAbsolute(args.file) ? args.file : path.join(ctx.directory, args.file)
    const result = yield* LSP.Service.use((lsp) => lsp.explain(file))
    process.stdout.write(JSON.stringify(result, null, 2) + EOL)
  }),
})

export const SymbolsCommand = effectCmd({
  command: "symbols <query>",
  describe: "search workspace symbols",
  builder: (yargs) => yargs.positional("query", { type: "string", demandOption: true }),
  handler: Effect.fn("Cli.debug.lsp.symbols")(function* (args) {
    yield* Effect.logInfo("symbols")
    const results = yield* LSP.Service.use((lsp) => lsp.workspaceSymbol(args.query))
    process.stdout.write(JSON.stringify(results, null, 2) + EOL)
  }),
})

export const DocumentSymbolsCommand = effectCmd({
  command: "document-symbols <uri>",
  describe: "get symbols from a document",
  builder: (yargs) => yargs.positional("uri", { type: "string", demandOption: true }),
  handler: Effect.fn("Cli.debug.lsp.documentSymbols")(function* (args) {
    yield* Effect.logInfo("document-symbols")
    const results = yield* LSP.Service.use((lsp) => lsp.documentSymbol(args.uri))
    process.stdout.write(JSON.stringify(results, null, 2) + EOL)
  }),
})
