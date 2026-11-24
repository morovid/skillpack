import { parseFrontmatter } from "../../../core/frontmatter.js";
import { findPlaceholders } from "../../../core/placeholders.js";
import { readTextFiles } from "../../../core/text-files.js";
import { listSkillSources, skillRel } from "../../../core/pack/index.js";
import { SKILL_FILE } from "../../../core/paths.js";
import type { CheckContext } from "../context.js";
import { checkNames } from "./names.js";

export function checkSkills(ctx: CheckContext): number {
  const sources = listSkillSources(ctx.dir);
  const valid: typeof sources = [];

  for (const s of sources) {
    if (s.skillText === null) {
      ctx.diag.warn("skill-no-skill-md", `folder has no ${SKILL_FILE}; skipped`, { file: skillRel(s.name) });
      continue;
    }
    valid.push(s);
    ctx.skillNames.add(s.name);
  }

  checkNames(ctx, "skill", valid.map((s) => ({ name: s.name, file: skillRel(s.name, SKILL_FILE) })));

  for (const s of valid) {
    const file = skillRel(s.name, SKILL_FILE);
    const fm = parseFrontmatter(s.skillText!);
    if (fm.kind === "none") {
      ctx.diag.error("skill-frontmatter", "missing YAML frontmatter", { file });
    } else if (fm.kind === "error") {
      ctx.diag.error("skill-frontmatter", fm.message, { file });
    } else {
      const d = fm.data;
      if (typeof d.name !== "string" || d.name === "") {
        ctx.diag.error("skill-fm-name", "frontmatter `name` is required", { file });
      } else {
        if (d.name !== s.name) {
          ctx.diag.error("skill-fm-name", `frontmatter name "${d.name}" must equal the folder name "${s.name}"`, { file });
        }
        if (findPlaceholders(d.name).length > 0) {
          ctx.diag.error("skill-fm-name-placeholder", "frontmatter `name` must not contain placeholders", { file });
        }
      }
      if (typeof d.description !== "string" || d.description.trim() === "") {
        ctx.diag.error("skill-fm-description", "frontmatter `description` is required and must not be empty", { file });
      } else if (d.description.length > 1024) {
        ctx.diag.error(
          "skill-fm-description",
          `frontmatter description is ${d.description.length} characters; the limit is 1024`,
          { file },
        );
      }
      const meta = d.metadata;
      const internal =
        typeof meta === "object" && meta !== null ? (meta as Record<string, unknown>).internal : undefined;
      if (internal === undefined) {
        ctx.diag.warn("skill-internal-missing", 'frontmatter should set metadata.internal: "true"', { file });
      } else if (internal !== "true") {
        ctx.diag.error(
          "skill-internal-type",
          typeof internal === "string"
            ? `metadata.internal must be the string "true", got "${internal}"`
            : 'metadata.internal must be the string "true", not a YAML boolean: quote it (internal: "true")',
          { file },
        );
      }
    }

    for (const f of readTextFiles(s.dir)) {
      ctx.scans.push({ file: skillRel(s.name, f.rel), text: f.text });
    }
  }
  return valid.length;
}
