// Deliberately limited metadata: unknown options and shell syntax retain raw behavior.
const OPTIONS: Record<string, Record<string, number>> = {
  npm: { "--silent": 0 },
  git: { "-C": 1 },
  "docker compose": { "-f": 1, "--file": 1 },
}

export function classify(tokens: string[]): string[] | undefined {
  if (!tokens.length || tokens.some((token) => !/^[a-zA-Z0-9_./:@=+-]+$/.test(token))) return
  if (!["npm", "git", "docker"].includes(tokens[0])) return
  const identity: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token.startsWith("-")) {
      identity.push(token)
      continue
    }
    const scope = tokens[0] === "npm" ? "npm" : identity.join(" ")
    const consumes = OPTIONS[scope]?.[token]
    if (consumes === undefined) return
    if (consumes && (!tokens[i + 1] || tokens[i + 1].startsWith("-"))) return
    i += consumes
  }
  const required =
    identity[0] === "npm" && ["run", "exec", "init", "view"].includes(identity[1])
      ? 3
      : identity[0] === "docker" && identity[1] === "compose"
        ? 3
        : 2
  if (identity.length < required) return
  return identity
}
