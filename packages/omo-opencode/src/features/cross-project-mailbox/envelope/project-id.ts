import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export function projectIdForRoot(repoRoot: string): string {
  const canonical = fs.realpathSync(repoRoot)
  const basename = path.basename(canonical)
  const slug = basename.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const hash = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 8)
  return `${slug}-${hash}`
}
