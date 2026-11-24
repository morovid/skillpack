import { loadAgentDefinitions, listSkillSources, loadSkillFiles } from "../../core/pack/index.js";
import { createPlainContext, renderSkill, type RenderedFile } from "../../core/render/index.js";

/** Renders every source skill of a (validated) pack into the plain build tree, in memory. */
export function renderPlainBuild(dir: string, scope: string): { files: RenderedFile[]; skills: string[] } {
  const skills = listSkillSources(dir).filter((s) => s.skillFile !== null);
  const fallbacks = new Map<string, string>();
  for (const a of loadAgentDefinitions(dir)) {
    const m = a.manifest;
    if (m.ok) fallbacks.set(a.name, (m.value as { fallback: string }).fallback);
  }
  const ctx = createPlainContext({ scope, skillNames: skills.map((s) => s.name), fallbacks });
  const files = skills.flatMap((s) => renderSkill(loadSkillFiles(s.name, s.dir), ctx));
  return { files, skills: skills.map((s) => ctx.skillFolderName(s.name)) };
}
