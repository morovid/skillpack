import { tokenize } from "../../../core/placeholders.js";
import type { CheckContext } from "../context.js";

export function checkPlaceholders(ctx: CheckContext): void {
  for (const { file, text } of ctx.scans) {
    for (const t of tokenize(text)) {
      const at = { file, line: t.line };
      if (t.kind === "unclosed") {
        ctx.diag.error("placeholder-unclosed", "unclosed placeholder: `{{` has no closing `}}` on the same line (write \\{{ for a literal {{)", at);
      } else if (t.kind === "unknown") {
        ctx.diag.error(
          "placeholder-unknown",
          `unknown placeholder ${t.raw}; use {{agent:<name>}}, {{skill:<name>}} or {{scope}} (write \\{{ for a literal {{)`,
          at,
        );
      } else if (t.kind === "agent" && !ctx.agentNames.has(t.name)) {
        ctx.diag.error("placeholder-agent", `${t.raw} names an agent that is not in src/agents/`, at);
      } else if (t.kind === "skill" && !ctx.skillNames.has(t.name)) {
        ctx.diag.error("placeholder-skill", `${t.raw} names a skill that is not in src/skills/`, at);
      }
    }
  }
}
