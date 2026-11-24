import semver from "semver";
import { formatPointer, schemaVersion, validateAgainst } from "../../../core/schema/index.js";
import { loadPackManifest } from "../../../core/pack/index.js";
import { HARNESSES } from "../../../core/harness.js";
import type { CheckContext } from "../context.js";

export function checkManifest(ctx: CheckContext): void {
  const { file, result } = loadPackManifest(ctx.dir);
  if (!result.ok) {
    ctx.diag.error(result.reason === "missing" ? "manifest-missing" : "manifest-json", result.message, { file });
    return;
  }
  const doc = result.value;
  const v = schemaVersion(doc, file);
  if ("error" in v) {
    ctx.diag.error("schema-version", v.error, { file });
    return;
  }
  const errors = validateAgainst("pack", doc);
  for (const e of errors) ctx.diag.error("manifest-schema", `${formatPointer(e.path)}: ${e.message}`, { file });
  if (errors.length > 0) return;

  const m = doc as { name: string; cli?: string; harnesses?: string[] };
  ctx.scope = m.name;
  ctx.harnesses = m.harnesses ?? HARNESSES;

  if (m.cli !== undefined) {
    const range = semver.validRange(m.cli);
    if (range === null) {
      ctx.diag.error("manifest-cli-range", `/cli: "${m.cli}" is not a valid semver range`, { file });
    } else if (!semver.satisfies(ctx.cliVersion, range, { includePrerelease: true })) {
      ctx.diag.error(
        "manifest-cli-version",
        `/cli: this pack needs skillpack ${m.cli}, but the running version is ${ctx.cliVersion}`,
        { file },
      );
    }
  }
}
