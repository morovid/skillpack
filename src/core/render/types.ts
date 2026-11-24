import type { TreeFile } from "../fs/tree.js";
import type { PlaceholderResolver } from "../placeholders.js";

export type RenderMode = "plain" | "install";

export type { TreeFile as RenderedFile };

export interface SkillSourceFiles {
  /** Source name (the folder name in src/skills/). */
  name: string;
  files: TreeFile[];
}

export interface RenderContext {
  mode: RenderMode;
  scope: string;
  resolver: PlaceholderResolver;
  /** Source names of every skill in the pack, for link rewriting. */
  skillNames: ReadonlySet<string>;
  /** Output folder name of a skill. */
  skillFolderName(sourceName: string): string;
}
