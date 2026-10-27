import type { CatalogModel } from "./ai-model-capabilities";

// Match globs without a user-generated regular expression or regex backtracking.
// Array.from makes ? consume one Unicode character, including astral symbols.
export function matchesModelSearch(value: string, query: string) {
  const pattern = query.trim().toLowerCase();
  const text = value.toLowerCase();
  if (!/[?*]/.test(pattern)) return text.includes(pattern);
  const characters = Array.from(text), tokens = Array.from(pattern);
  let position = 0, token = 0, star = -1, retry = 0;
  while (position < characters.length) {
    if (tokens[token] === "?" || tokens[token] === characters[position]) { token++; position++; }
    else if (tokens[token] === "*") { star = token++; retry = position; }
    else if (star >= 0) { token = star + 1; position = ++retry; }
    else return false;
  }
  while (tokens[token] === "*") token++;
  return token === tokens.length;
}

export function matchesCatalogModel(model: Pick<CatalogModel, "id" | "name" | "searchTerms">, query: string) {
  return [model.id, model.name, ...(model.searchTerms ?? [])].some(value => matchesModelSearch(value, query));
}
