import { Diagnostics } from "../../core/diagnostics.js";
import { checkAgents } from "./checks/agents.js";
import { checkManifest } from "./checks/manifest.js";
import { checkPlaceholders } from "./checks/placeholders.js";
import { checkSkills } from "./checks/skills.js";
import { checkSpawnGraph } from "./checks/spawn-graph.js";
import type { CheckContext } from "./context.js";

export interface ValidationResult {
  name?: string;
  skills: number;
  agents: number;
  diagnostics: Diagnostics;
}

export function validatePack(dir: string, opts: { cliVersion: string }): ValidationResult {
  const diag = new Diagnostics();
  const ctx: CheckContext = {
    dir,
    cliVersion: opts.cliVersion,
    diag,
    skillNames: new Set(),
    agentNames: new Set(),
    scans: [],
  };
  checkManifest(ctx);
  const skills = checkSkills(ctx);
  const agents = checkAgents(ctx);
  checkSpawnGraph(ctx, agents.graph);
  checkPlaceholders(ctx);
  if (ctx.skillNames.size === 0 && ctx.agentNames.size === 0) {
    diag.warn("pack-empty", "the pack has no skills in src/skills/ and no agents in src/agents/");
  }
  const result: ValidationResult = { skills, agents: agents.count, diagnostics: diag };
  if (ctx.scope !== undefined) result.name = ctx.scope;
  return result;
}
