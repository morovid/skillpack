import { readTree } from "../fs/tree.js";
import type { SkillSourceFiles } from "../render/types.js";

/** Reads a whole skill source folder (files, bytes, modes) into memory. */
export function loadSkillFiles(name: string, dir: string): SkillSourceFiles {
  return { name, files: readTree(dir) };
}
