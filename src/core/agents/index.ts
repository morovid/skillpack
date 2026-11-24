import type { Harness } from "../harness.js";
import { generateCodex } from "./codex.js";
import { generateOpenCode } from "./opencode.js";
import type { GenerateAgentInput, GeneratedAgent } from "./types.js";

export * from "./capabilities.js";
export * from "./definition.js";
export * from "./header.js";
export * from "./types.js";
export { OPENCODE_ACTIONS, opencodePermissions } from "./opencode.js";

/** Generates the agent file of one harness. The agent must be bound to `generate` there. */
export function generateAgent(harness: Harness, input: GenerateAgentInput): GeneratedAgent {
  return harness === "opencode" ? generateOpenCode(input) : generateCodex(input);
}
