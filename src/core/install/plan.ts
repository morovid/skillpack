import { agentIdFor, bindingOf, type Bindings } from "../bindings.js";
import { generateAgent, type AgentSpec, type AgentModelInput, type AgentWarning } from "../agents/index.js";
import type { TreeFile } from "../fs/tree.js";
import { sortFiles } from "../fs/tree.js";
import type { Harness } from "../harness.js";
import { createInstallContext, renderSkill, type SkillSourceFiles } from "../render/index.js";

export { INSTALLED_SKILLS_DIR } from "../project/paths.js";
import { INSTALLED_SKILLS_DIR } from "../project/paths.js";

export interface InstallPlanInput {
  scope: string;
  pack: { source: string; version: string };
  skills: SkillSourceFiles[];
  agents: AgentSpec[];
  /** Harnesses the pack is installed for (skills are phrased for all of them). */
  harnesses: readonly Harness[];
  /** Harnesses to generate agent files for; default all of `harnesses` (install skips undetected ones). */
  agentHarnesses?: readonly Harness[];
  bindings: Bindings;
  /** Concrete model per agent and harness, when known (from the models file). */
  modelFor?: (agent: string, harness: Harness) => string | undefined;
  /**
   * Without a concrete model: use the requested model names and effort anyway (render previews),
   * or leave `model` and effort out so the agent uses the parent session's model (real installs
   * until model matching exists).
   */
  requestedModelFallback?: boolean;
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

  for (const harness of input.agentHarnesses ?? harnesses) {
    const forHarness = Object.fromEntries(input.agents.map((a) => [a.name, bindingOf(bindings, a.name, harness)]));
    for (const a of input.agents) {
      if (agentIdFor(scope, a.name, forHarness[a.name]!) === null || forHarness[a.name]!.kind !== "generate") continue;
      const concrete = input.modelFor?.(a.name, harness);
      const useRequested = concrete !== undefined || input.requestedModelFallback === true;
      const model: AgentModelInput = { requested: useRequested ? a.modelNames : [] };
      if (concrete !== undefined) model.concrete = concrete;
      if (a.effort !== undefined && useRequested) model.effort = a.effort;
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
