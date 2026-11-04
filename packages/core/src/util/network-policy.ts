export type NetworkPolicy = "allow" | "local-only"
export function getNetworkPolicy(env: Record<string, string | undefined> = process.env): NetworkPolicy {
  const value = env.SENSEGREP_NETWORK_POLICY ?? "allow"
  if (value !== "allow" && value !== "local-only") throw new Error("SENSEGREP_NETWORK_POLICY must be allow or local-only")
  return value
}
export function assertNetworkAllowed(endpoint: string, env: Record<string, string | undefined> = process.env): void {
  if (getNetworkPolicy(env) === "allow") return
  const url = new URL(endpoint)
  if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Network policy local-only blocks this remote endpoint")
  }
}
