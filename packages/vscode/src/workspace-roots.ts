import path from "node:path"

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => path.resolve(value).replace(/\\/g, "/").toLowerCase()
  return normalize(left) === normalize(right)
}

export function selectWorkspaceRoot(roots: string[], activeRoot: string | undefined, fallback: string): string {
  if (activeRoot) {
    const match = roots.find((root) => samePath(root, activeRoot))
    if (match) return match
  }
  const fallbackMatch = roots.find((root) => samePath(root, fallback))
  return fallbackMatch ?? roots[0] ?? fallback
}
