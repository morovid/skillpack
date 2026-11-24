import type { Diagnostics } from "../../core/diagnostics.js";

export interface ScanTarget {
  file: string;
  text: string;
}

export interface CheckContext {
  dir: string;
  cliVersion: string;
  diag: Diagnostics;
  /** Pack scope, when the manifest is usable. */
  scope?: string;
  harnesses?: readonly string[];
  /** Source names (folder names) of skills that have a SKILL.md. */
  skillNames: Set<string>;
  agentNames: Set<string>;
  /** Texts to scan for placeholders once all names are known. */
  scans: ScanTarget[];
}
