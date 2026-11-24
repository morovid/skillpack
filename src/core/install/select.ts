import { HARNESSES, isHarness, sortHarnesses, type Harness } from "../harness.js";

/** A problem with the user's selection. `usage` errors exit 2, the others 1. */
export class InstallError extends Error {
  constructor(
    message: string,
    readonly usage = false,
  ) {
    super(message);
    this.name = "InstallError";
  }
}

const split = (flags: readonly string[]): string[] => flags.flatMap((f) => f.split(",")).map((s) => s.trim()).filter(Boolean);

/**
 * Harnesses to install for (R-CLI-2, R-CLI-4, R-VER-1b): `-a` (restricted to what the manifest
 * supports), else the detected ones (restricted the same way).
 */
export function selectHarnesses(o: { flags: readonly string[]; supported: readonly Harness[] | null; detected: readonly Harness[] }): Harness[] {
  const supported = o.supported ?? HARNESSES;
  const names = split(o.flags);
  if (names.length > 0) {
    if (names.includes("*")) return sortHarnesses(supported);
    for (const n of names) {
      if (!isHarness(n)) throw new InstallError(`unknown harness "${n}" (use ${HARNESSES.join(", ")} or *)`, true);
      if (!supported.includes(n)) throw new InstallError(`this pack doesn't support the harness "${n}" (supported: ${supported.join(", ")})`, true);
    }
    return sortHarnesses(names as Harness[]);
  }
  const found = sortHarnesses(o.detected.filter((h) => supported.includes(h)));
  if (found.length === 0) {
    throw new InstallError(
      `no supported harness detected (${supported.join(", ")}); pass -a <harness>, for example -a ${supported[0]}`,
    );
  }
  return found;
}

/** `-s` names (or `*`/nothing for all). Every name must exist in the pack. */
export function selectSkills(o: { flags: readonly string[]; available: readonly string[] }): "*" | string[] {
  const names = split(o.flags);
  if (names.length === 0 || names.includes("*")) return "*";
  for (const n of names) {
    if (!o.available.includes(n)) throw new InstallError(`the pack has no skill "${n}" (available: ${o.available.join(", ")})`, true);
  }
  return [...new Set(names)];
}
