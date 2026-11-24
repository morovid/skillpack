import { MAX_SCOPED_NAME_LENGTH, isValidName, scopedName, toKebab } from "../../../core/names.js";
import type { CheckContext } from "../context.js";

/** Shared name checks for skills and agents: pattern, scoped length, kebab collisions. */
export function checkNames(
  ctx: CheckContext,
  kind: "skill" | "agent",
  entries: { name: string; file: string }[],
): void {
  const seen = new Map<string, string>();
  for (const { name, file } of entries) {
    if (!isValidName(name)) {
      ctx.diag.error(`${kind}-name`, `${kind} folder name "${name}" must match ^[a-z0-9]+([-_][a-z0-9]+)*$`, { file });
      continue;
    }
    if (ctx.scope !== undefined) {
      const full = scopedName(ctx.scope, name);
      if (full.length > MAX_SCOPED_NAME_LENGTH) {
        ctx.diag.error(
          `${kind}-name-length`,
          `installed name "${full}" is ${full.length} characters; the limit is ${MAX_SCOPED_NAME_LENGTH}`,
          { file },
        );
      }
    }
    const kebab = toKebab(name);
    const other = seen.get(kebab);
    if (other !== undefined) {
      ctx.diag.error(
        `${kind}-name-collision`,
        `${kind} "${name}" and "${other}" both install as "${kebab}"`,
        { file },
      );
    } else seen.set(kebab, name);
  }
}
