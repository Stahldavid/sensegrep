import path from "node:path"
import type { IndexFileKind } from "./index-file-rules.js"

export type FileRole =
  | "implementation"
  | "test"
  | "generated"
  | "contract"
  | "configuration"
  | "documentation"
  | "migration"
  | "fixture"
  | "build-artifact"

export type SearchPurpose = "understand" | "implement" | "review" | "test"

export function classifyFileRole(filePath: string, fileKind?: IndexFileKind): FileRole {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase()
  const base = path.posix.basename(normalized)
  if (/(^|\/)(dist|build|out|coverage|\.next|target|bin|obj)(\/|$)/.test(normalized)) return "build-artifact"
  if (/(^|\/)(_generated|generated|gen)(\/|$)/.test(normalized) || /\.(generated|gen)\.[^.]+$/.test(base)) return "generated"
  if (/(^|\/)(__tests__|tests?|specs?)(\/|$)/.test(normalized) || /\.(test|spec)\.[^.]+$/.test(base)) return "test"
  if (/(^|\/)(__fixtures__|fixtures?|mocks?|testdata)(\/|$)/.test(normalized)) return "fixture"
  if (/(^|\/)(migrations?|prisma\/migrations)(\/|$)/.test(normalized)) return "migration"
  if (fileKind === "config") return "configuration"
  if (fileKind === "doc") return "documentation"
  if (/\.d\.[cm]?tsx?$/.test(base) || /(^|\/)(types?|contracts?|schemas?)(\/|$)/.test(normalized)) return "contract"
  return "implementation"
}

const PURPOSE_WEIGHTS: Record<SearchPurpose, Partial<Record<FileRole, number>>> = {
  understand: { implementation: 0.08, contract: 0.05, test: -0.02, generated: -0.15, "build-artifact": -0.2 },
  implement: { implementation: 0.1, contract: 0.03, test: 0.01, generated: -0.18, "build-artifact": -0.2 },
  review: { implementation: 0.05, test: 0.06, contract: 0.02, generated: -0.12, "build-artifact": -0.2 },
  test: { test: 0.1, fixture: 0.06, implementation: 0.03, generated: -0.15, "build-artifact": -0.2 },
}

export function fileRoleBoost(role: FileRole, purpose: SearchPurpose = "understand", preferred?: FileRole): number {
  return (PURPOSE_WEIGHTS[purpose][role] ?? 0) + (preferred === role ? 0.08 : 0)
}
