/** Read a declared option only when the caller supplied it as an own property. */
export function ownOption<T extends object, K extends keyof T>(
  options: T | undefined,
  key: K,
): T[K] | undefined {
  return options !== undefined && Object.hasOwn(options, key)
    ? options[key]
    : undefined;
}
