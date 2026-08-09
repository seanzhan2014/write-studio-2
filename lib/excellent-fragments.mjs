const CONTEXT_CHARACTERS = 32;

export function contentFingerprint(value) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function trimmedRange(content, start, end) {
  let normalizedStart = Math.max(0, Math.min(content.length, Math.trunc(Number(start) || 0)));
  let normalizedEnd = Math.max(normalizedStart, Math.min(content.length, Math.trunc(Number(end) || 0)));
  while (normalizedStart < normalizedEnd && /\s/u.test(content[normalizedStart])) normalizedStart += 1;
  while (normalizedEnd > normalizedStart && /\s/u.test(content[normalizedEnd - 1])) normalizedEnd -= 1;
  return normalizedEnd > normalizedStart ? { start: normalizedStart, end: normalizedEnd } : null;
}

function fragmentAt(content, source, start, end, updatedAt) {
  return {
    ...source,
    start,
    end,
    text: content.slice(start, end),
    prefix: content.slice(Math.max(0, start - CONTEXT_CHARACTERS), start),
    suffix: content.slice(end, Math.min(content.length, end + CONTEXT_CHARACTERS)),
    sourceHash: contentFingerprint(content),
    updatedAt,
  };
}

export function normalizeExcellentFragments(contentValue, fragmentsValue) {
  const content = String(contentValue ?? "");
  const fragments = Array.isArray(fragmentsValue) ? fragmentsValue : [];
  const normalized = fragments.flatMap((fragment, index) => {
    const range = trimmedRange(content, fragment?.start, fragment?.end);
    if (!range) return [];
    const createdAt = String(fragment?.createdAt ?? fragment?.updatedAt ?? new Date(0).toISOString());
    const updatedAt = String(fragment?.updatedAt ?? createdAt);
    return [fragmentAt(content, {
      id: String(fragment?.id ?? `excellent-${index}`),
      createdAt,
    }, range.start, range.end, updatedAt)];
  }).sort((left, right) => left.start - right.start || left.end - right.end);

  const merged = [];
  for (const fragment of normalized) {
    const previous = merged.at(-1);
    if (!previous || fragment.start > previous.end) {
      merged.push(fragment);
      continue;
    }
    const createdAt = new Date(previous.createdAt).getTime() <= new Date(fragment.createdAt).getTime() ? previous.createdAt : fragment.createdAt;
    merged[merged.length - 1] = fragmentAt(content, { id: previous.id, createdAt }, previous.start, Math.max(previous.end, fragment.end), fragment.updatedAt);
  }
  return merged;
}

function freshExcellentFragmentId() {
  const uuid = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `excellent-${uuid}`;
}

// A fragment belongs to one stored content/version. When content is copied
// into a new version, keep its range and text but give it a new database key.
export function cloneExcellentFragments(contentValue, fragmentsValue) {
  return normalizeExcellentFragments(contentValue, fragmentsValue).map((fragment) => ({
    ...fragment,
    id: freshExcellentFragmentId(),
  }));
}

export function toggleExcellentFragment(contentValue, fragmentsValue, selection, create) {
  const content = String(contentValue ?? "");
  const fragments = normalizeExcellentFragments(content, fragmentsValue);
  const range = trimmedRange(content, selection?.start, selection?.end);
  if (!range) return { action: "none", fragments };

  const containing = fragments.find((fragment) => range.start >= fragment.start && range.end <= fragment.end);
  if (containing) {
    return { action: "removed", fragments: fragments.filter((fragment) => fragment.id !== containing.id) };
  }

  const touching = fragments.filter((fragment) => range.start <= fragment.end && range.end >= fragment.start);
  const start = touching.reduce((value, fragment) => Math.min(value, fragment.start), range.start);
  const end = touching.reduce((value, fragment) => Math.max(value, fragment.end), range.end);
  const now = String(create?.updatedAt ?? create?.createdAt ?? new Date().toISOString());
  const source = touching[0]
    ? { id: touching[0].id, createdAt: touching.reduce((value, fragment) => new Date(fragment.createdAt).getTime() < new Date(value).getTime() ? fragment.createdAt : value, touching[0].createdAt) }
    : { id: String(create?.id ?? `excellent-${Date.now()}`), createdAt: String(create?.createdAt ?? now) };
  const replacement = fragmentAt(content, source, start, end, now);
  const touchingIds = new Set(touching.map((fragment) => fragment.id));
  return {
    action: "added",
    fragments: normalizeExcellentFragments(content, [...fragments.filter((fragment) => !touchingIds.has(fragment.id)), replacement]),
  };
}

function allOccurrences(content, value) {
  const result = [];
  let from = 0;
  while (value && from <= content.length) {
    const index = content.indexOf(value, from);
    if (index < 0) break;
    result.push(index);
    from = index + Math.max(value.length, 1);
  }
  return result;
}

function anchorScore(content, fragment, start) {
  const prefix = content.slice(Math.max(0, start - fragment.prefix.length), start);
  const suffix = content.slice(start + fragment.text.length, start + fragment.text.length + fragment.suffix.length);
  let prefixMatch = 0;
  while (prefixMatch < prefix.length && prefix[prefix.length - 1 - prefixMatch] === fragment.prefix[fragment.prefix.length - 1 - prefixMatch]) prefixMatch += 1;
  let suffixMatch = 0;
  while (suffixMatch < suffix.length && suffix[suffixMatch] === fragment.suffix[suffixMatch]) suffixMatch += 1;
  return prefixMatch * 4 + suffixMatch * 4 - Math.abs(start - fragment.start) / Math.max(1, content.length);
}

export function reanchorExcellentFragments(previousContentValue, nextContentValue, fragmentsValue) {
  const previousContent = String(previousContentValue ?? "");
  const nextContent = String(nextContentValue ?? "");
  const fragments = normalizeExcellentFragments(previousContent, fragmentsValue);
  const updatedAt = new Date().toISOString();
  const reanchored = fragments.flatMap((fragment) => {
    if (!fragment.text) return [];
    if (nextContent.slice(fragment.start, fragment.end) === fragment.text) {
      return [fragmentAt(nextContent, fragment, fragment.start, fragment.end, updatedAt)];
    }
    const occurrences = allOccurrences(nextContent, fragment.text);
    if (!occurrences.length) return [];
    const start = occurrences.sort((left, right) => anchorScore(nextContent, fragment, right) - anchorScore(nextContent, fragment, left))[0];
    return [fragmentAt(nextContent, fragment, start, start + fragment.text.length, updatedAt)];
  });
  return normalizeExcellentFragments(nextContent, reanchored);
}

export function paragraphRangeAt(contentValue, offsetValue) {
  const content = String(contentValue ?? "");
  if (!content.length) return null;
  const offset = Math.max(0, Math.min(content.length - 1, Math.trunc(Number(offsetValue) || 0)));
  const separator = /\n[\t \r]*\n+/g;
  let start = 0;
  let end = content.length;
  for (const match of content.matchAll(separator)) {
    const separatorStart = match.index ?? 0;
    const separatorEnd = separatorStart + match[0].length;
    if (separatorEnd <= offset) start = separatorEnd;
    else if (separatorStart >= offset) { end = separatorStart; break; }
  }
  return trimmedRange(content, start, end);
}
