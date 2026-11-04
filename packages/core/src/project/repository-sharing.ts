import path from "node:path"
import { Global } from "../global/index.js"
import { readRepositoryId } from "./repository-identity.js"

/** Repository registration is explicit; sharing requires an additional opt-in. */
export async function sharedRepositoryScope(root: string): Promise<string | undefined> {
  if (!["1", "true", "yes", "on"].includes(String(process.env.SENSEGREP_SHARED_OBJECTS ?? "").toLowerCase())) return undefined
  return readRepositoryId(root)
}

export function sharedSourceDirectory(repositoryId: string): string {
  return path.join(Global.Path.data, "shared-objects-v1", repositoryId, "sources")
}
