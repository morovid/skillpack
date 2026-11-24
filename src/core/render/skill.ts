import { isMap, isScalar, parseDocument } from "yaml";
import { splitFrontmatter } from "../frontmatter.js";
import { normalizeMode, sortFiles, type TreeFile } from "../fs/tree.js";
import { scopedName, toKebab } from "../names.js";
import { SKILL_FILE, SKILL_SOURCES_DIR } from "../paths.js";
import { renderPlaceholders } from "../placeholders.js";
import { isTextFile } from "../text-files.js";
import { rewriteSkillLinks } from "./links.js";
import type { RenderContext, RenderedFile, SkillSourceFiles } from "./types.js";

export class RenderError extends Error {}

export function outputFolderName(ctx: RenderContext, sourceName: string): string {
  return ctx.mode === "plain" ? toKebab(sourceName) : scopedName(ctx.scope, sourceName);
}

const generatedComment = (source: string): string =>
  `<!-- generated from ${SKILL_SOURCES_DIR.split("\\").join("/")}/${source} by skillpack build; edit the source -->`;

function renderText(text: string, file: string, depth: number, ctx: RenderContext): string {
  const linked = file.endsWith(".md")
    ? rewriteSkillLinks(text, depth, ctx.skillNames, ctx.skillFolderName)
    : text;
  return renderPlaceholders(linked, ctx.resolver);
}

function renderSkillMd(text: string, source: string, folder: string, ctx: RenderContext): string {
  const parts = splitFrontmatter(text);
  if (!parts) throw new RenderError(`${SKILL_FILE} of "${source}" has no frontmatter`);
  const doc = parseDocument(parts.yaml);
  if (doc.errors.length > 0) throw new RenderError(`${SKILL_FILE} of "${source}": ${doc.errors[0]!.message}`);

  const name = doc.get("name", true);
  if (isScalar(name)) name.value = folder;
  else doc.set("name", folder);

  const description = doc.get("description", true);
  if (isScalar(description) && typeof description.value === "string") {
    description.value = renderPlaceholders(description.value, ctx.resolver);
  }

  const metadata = doc.get("metadata", true);
  if (isMap(metadata)) {
    metadata.delete("internal");
    if (metadata.items.length === 0) doc.delete("metadata");
  }

  let yaml = doc.toString({ lineWidth: 0 });
  if (yaml !== "" && !yaml.endsWith("\n")) yaml += "\n";
  if (parts.eol === "\r\n") yaml = yaml.replaceAll("\n", "\r\n");

  let body = renderText(parts.rest, SKILL_FILE, 0, ctx);
  if (ctx.mode === "plain") {
    const blank = /^\r?\n/.test(body);
    body = generatedComment(source) + parts.eol + (blank ? "" : parts.eol) + body;
  }
  return `${parts.bom}---${parts.eol}${yaml}---${parts.eol}${body}`;
}

/**
 * Pure: renders one skill source into output files, sorted by path. Paths start with the output
 * folder name. Same input, byte-identical output.
 */
export function renderSkill(source: SkillSourceFiles, ctx: RenderContext): RenderedFile[] {
  const folder = outputFolderName(ctx, source.name);
  const out: RenderedFile[] = source.files.map((f: TreeFile) => {
    const depth = f.path.split("/").length - 1;
    let content = f.content;
    if (f.path === SKILL_FILE) {
      content = Buffer.from(renderSkillMd(f.content.toString("utf8"), source.name, folder, ctx));
    } else if (isTextFile(f.path)) {
      content = Buffer.from(renderText(f.content.toString("utf8"), f.path, depth, ctx));
    }
    return { path: `${folder}/${f.path}`, content, mode: normalizeMode(f.mode) };
  });
  return sortFiles(out);
}
