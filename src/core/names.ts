export const NAME_PATTERN = /^[a-z0-9]+([-_][a-z0-9]+)*$/;
export const MAX_SCOPE_LENGTH = 24;
export const MAX_SCOPED_NAME_LENGTH = 64;

export function isValidName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

export function toKebab(name: string): string {
  return name.replaceAll("_", "-");
}

export function scopedName(scope: string, name: string): string {
  return `${toKebab(scope)}-${toKebab(name)}`;
}
