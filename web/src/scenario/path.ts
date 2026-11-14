export type Path = ReadonlyArray<string | number>;

export function getIn(root: unknown, path: Path): unknown {
  let cur: unknown = root;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

export function setIn<T>(root: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path as [string | number, ...Array<string | number>];
  if (Array.isArray(root)) {
    const copy = root.slice() as unknown[];
    const idx = Number(head);
    if (value === undefined && rest.length === 0) copy.splice(idx, 1);
    else copy[idx] = setIn(copy[idx], rest, value);
    return copy as T;
  }
  const obj: Record<string | number, unknown> = { ...(root as Record<string | number, unknown> | undefined) };
  if (value === undefined && rest.length === 0) delete obj[head];
  else obj[head] = setIn(obj[head], rest, value);
  return obj as T;
}

export const pathKey = (path: Path): string => path.join(".");
