import { agentIdFor, bindingOf, type Bindings } from "../bindings.js";
import { generateAgent, type AgentSpec, type AgentModelInput, type AgentWarning } from "../agents/index.js";
import type { TreeFile } from "../fs/tree.js";
import { sortFiles } from "../fs/tree.js";
import type { Harness } from "../harness.js";
import { createInstallContext, renderSkill, type SkillSourceFiles } from "../render/index.js";

export const INSTALLED_SKILLS_DIR = ".agents/skills";

export interface InstallPlanInput {
  scope: string;
  pack: { source: string; version: string };
  skills: SkillSourceFiles[];
  agents: AgentSpec[];
  harnesses: readonly Harness[];
  bindings: Bindings;
  /** Concrete model per agent and harness, when known (from the models file). */
  modelFor?: (agent: string, harness: Harness) => string | undefined;
}

export interface InstallPlan {
  /** Every file to write, relative to the project root, sorted by path. */
  files: TreeFile[];
  warnings: AgentWarning[];
}

/** Renders the whole install of one pack in memory: shared skills plus the generated agents. */
export function planInstall(input: InstallPlanInput): InstallPlan {
  const { scope, harnesses, bindings } = input;
  const agents = new Map(input.agents.map((a) => [a.name, a]));
  const ctx = createInstallContext({
    scope,
    skillNames: input.skills.map((s) => s.name),
    agents,
    harnesses,
    bindings,
  });

  const files: TreeFile[] = input.skills.flatMap((s) =>
    renderSkill(s, ctx).map((f) => ({ ...f, path: `${INSTALLED_SKILLS_DIR}/${f.path}` })),
  );
  const warnings: AgentWarning[] = [];

  for (const harness of harnesses) {
    const forHarness = Object.fromEntries(input.agents.map((a) => [a.name, bindingOf(bindings, a.name, harness)]));
    for (const a of input.agents) {
      if (agentIdFor(scope, a.name, forHarness[a.name]!) === null || forHarness[a.name]!.kind !== "generate") continue;
      const model: AgentModelInput = { requested: a.modelNames };
      const concrete = input.modelFor?.(a.name, harness);
      if (concrete !== undefined) model.concrete = concrete;
      if (a.effort !== undefined) model.effort = a.effort;
      const out = generateAgent(harness, {
        pack: { source: input.pack.source, version: input.pack.version, scope },
        agentName: a.name,
        agents,
        bindings: forHarness,
        model,
      });
      files.push({ path: out.path, content: Buffer.from(out.content), mode: 0o644 });
      warnings.push(...out.warnings);
    }
  }
  return { files: sortFiles(files), warnings };
}
