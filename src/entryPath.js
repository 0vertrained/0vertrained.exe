// An immutable field edit used by the live log and its durable Watch journal.
export function setEntryPath(entry, keys, value) {
  const [key, ...rest] = keys;
  return { ...entry, [key]: rest.length ? setEntryPath(entry?.[key], rest, value) : value };
}
