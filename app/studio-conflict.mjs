const MISSING = Symbol("missing");

function clone(value) {
  if (value === MISSING) return MISSING;
  return structuredClone(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function stableStudioStringify(value) {
  return JSON.stringify(stableValue(value));
}

const same = (left, right) => {
  if (left === MISSING || right === MISSING) return left === right;
  return stableStudioStringify(left) === stableStudioStringify(right);
};

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isKeyedArray(...arrays) {
  const values = arrays.filter((value) => value !== MISSING);
  if (!values.length || !values.every(Array.isArray)) return false;
  const items = values.flat();
  return items.length > 0 && items.every((item) => isPlainObject(item) && typeof item.id === "string");
}

function changedOrder(baseIds, sideIds) {
  const sideSet = new Set(sideIds);
  const baseSet = new Set(baseIds);
  return !same(baseIds.filter((id) => sideSet.has(id)), sideIds.filter((id) => baseSet.has(id)));
}

function addMissingIds(primary, secondary) {
  const result = [...primary];
  for (let index = 0; index < secondary.length; index += 1) {
    const id = secondary[index];
    if (result.includes(id)) continue;
    const previous = secondary.slice(0, index).reverse().find((candidate) => result.includes(candidate));
    if (previous) {
      result.splice(result.lastIndexOf(previous) + 1, 0, id);
      continue;
    }
    const next = secondary.slice(index + 1).find((candidate) => result.includes(candidate));
    if (next) result.splice(result.indexOf(next), 0, id);
    else result.push(id);
  }
  return result;
}

function pathText(path) {
  return path.map((part, index) => typeof part === "string"
    ? `${index ? "." : ""}${part}`
    : `[${part.id}]`).join("");
}

function findEntity(data, collection, id) {
  if (!data || !id) return null;
  if (collection === "articles") return (data.articles ?? []).find((item) => item.id === id) ?? null;
  for (const article of data.articles ?? []) {
    if (collection === "characters") {
      const item = (article.characters ?? []).find((candidate) => candidate.id === id);
      if (item) return item;
    }
    if (collection === "relationships") {
      const item = (article.relationships ?? []).find((candidate) => candidate.id === id);
      if (item) return item;
    }
    for (const chapter of article.chapters ?? []) {
      if (collection === "chapters" && chapter.id === id) return chapter;
      for (const outline of chapter.outlines ?? []) {
        if (collection === "outlines" && outline.id === id) return outline;
        if (collection === "versions") {
          const item = (outline.versions ?? []).find((candidate) => candidate.id === id);
          if (item) return item;
        }
        if (collection === "sessions") {
          const item = (outline.chat?.sessions ?? []).find((candidate) => candidate.id === id);
          if (item) return item;
        }
        if (collection === "messages") {
          for (const session of outline.chat?.sessions ?? []) {
            const item = (session.messages ?? []).find((candidate) => candidate.id === id);
            if (item) return item;
          }
        }
      }
    }
  }
  if (collection === "tasks") return (data.tasks ?? []).find((item) => item.id === id) ?? null;
  return null;
}

const entityNames = {
  articles: "文章",
  chapters: "章节",
  outlines: "大纲",
  versions: "正文版本",
  sessions: "对话",
  messages: "消息",
  characters: "人物",
  relationships: "人物关系",
  tasks: "AI 任务",
};

const fieldNames = {
  title: "标题",
  plan: "大纲内容",
  content: "正文",
  contentName: "正文名称",
  summary: "简介",
  style: "文风",
  type: "类型",
  description: "描述",
  name: "名称",
  text: "内容",
  messages: "消息列表",
  versions: "版本列表",
  chapters: "章节顺序",
  outlines: "大纲顺序",
  defaultVersionId: "默认正文",
  currentVersionId: "当前正文",
  settings: "设置",
  $order: "排序",
};

function displayValue(value) {
  if (value === MISSING) return "（已删除）";
  if (value === null || value === undefined || value === "") return "（空）";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function describeConflict(path, localValue, serverValue, localRoot, serverRoot) {
  const entityPart = [...path].reverse().find((part) => typeof part !== "string" && entityNames[part.collection]);
  const field = typeof path.at(-1) === "string" ? path.at(-1) : "$order";
  const collection = entityPart?.collection;
  const entity = collection ? findEntity(localRoot, collection, entityPart.id) ?? findEntity(serverRoot, collection, entityPart.id) : null;
  const title = String(entity?.title ?? entity?.name ?? entity?.text ?? "").trim().slice(0, 80);
  const entityName = collection ? entityNames[collection] : entityNames[path[0]] ?? (path[0] === "settings" ? "设置" : "数据");
  const fieldName = fieldNames[field] ?? field;
  return {
    path: pathText(path),
    entityType: collection ?? (path[0] === "settings" ? "settings" : "data"),
    entityId: entityPart?.id ?? "",
    title,
    label: `${entityName}${title ? `“${title}”` : ""}的${fieldName}`,
    localText: displayValue(localValue),
    serverText: displayValue(serverValue),
  };
}

function recordConflict(context, path, localValue, serverValue) {
  context.conflicts.push(describeConflict(path, localValue, serverValue, context.localRoot, context.serverRoot));
  if (context.preference === "local") return clone(localValue);
  return clone(serverValue);
}

const serverOwnedTaskFields = new Set([
  "state", "phase", "attempt", "startedAt", "completedAt", "lastProgressAt",
  "receivedCharacters", "runnerId", "leaseUntil", "resultText", "resultVersionId",
  "error", "inputTokens", "outputTokens",
]);

function serverOwnsField(path) {
  const entityPart = [...path].reverse().find((part) => typeof part !== "string");
  const field = typeof path.at(-1) === "string" ? path.at(-1) : "";
  // Creation timestamps are immutable system metadata, not editable content.
  // Legacy rows can synthesize the fixed `name-current:*` version on both
  // sides with different fallback timestamps. The database should settle
  // that metadata without asking the user to resolve a content conflict.
  if (field === "createdAt") return true;
  if (entityPart?.collection === "tasks" && serverOwnedTaskFields.has(field)) return true;
  // Outline.state only mirrors the durable AI worker lifecycle. User-authored
  // outline and body fields continue through the normal three-way merge.
  return entityPart?.collection === "outlines" && field === "state";
}

function mergeKeyedArray(base, local, server, path, context) {
  const baseMap = new Map(base.map((item) => [item.id, item]));
  const localMap = new Map(local.map((item) => [item.id, item]));
  const serverMap = new Map(server.map((item) => [item.id, item]));
  const ids = new Set([...baseMap.keys(), ...localMap.keys(), ...serverMap.keys()]);
  const merged = new Map();
  const collection = typeof path.at(-1) === "string" ? path.at(-1) : "items";
  for (const id of ids) {
    const value = mergeValue(
      baseMap.has(id) ? baseMap.get(id) : MISSING,
      localMap.has(id) ? localMap.get(id) : MISSING,
      serverMap.has(id) ? serverMap.get(id) : MISSING,
      [...path, { collection, id }],
      context,
    );
    if (value !== MISSING) merged.set(id, value);
  }

  const baseIds = base.map((item) => item.id);
  const localIds = local.map((item) => item.id);
  const serverIds = server.map((item) => item.id);
  const localReordered = changedOrder(baseIds, localIds);
  const serverReordered = changedOrder(baseIds, serverIds);
  let primary = serverIds;
  let secondary = localIds;
  if (localReordered && !serverReordered) {
    primary = localIds;
    secondary = serverIds;
  } else if (localReordered && serverReordered) {
    const localCommon = localIds.filter((id) => baseMap.has(id) && serverMap.has(id));
    const serverCommon = serverIds.filter((id) => baseMap.has(id) && localMap.has(id));
    if (!same(localCommon, serverCommon)) {
      context.conflicts.push(describeConflict([...path, "$order"], localIds, serverIds, context.localRoot, context.serverRoot));
      if (context.preference === "local") {
        primary = localIds;
        secondary = serverIds;
      }
    }
  }
  return addMissingIds(primary, secondary).filter((id) => merged.has(id)).map((id) => merged.get(id));
}

function mergeValue(base, local, server, path, context) {
  if (same(local, server)) return clone(local);

  const field = typeof path.at(-1) === "string" ? path.at(-1) : "";
  if (serverOwnsField(path)) return clone(server);

  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(server) && isKeyedArray(base, local, server)) {
    return mergeKeyedArray(base, local, server, path, context);
  }

  if (isPlainObject(base) && isPlainObject(local) && isPlainObject(server)) {
    const result = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(server)]);
    for (const key of keys) {
      const value = mergeValue(
        Object.prototype.hasOwnProperty.call(base, key) ? base[key] : MISSING,
        Object.prototype.hasOwnProperty.call(local, key) ? local[key] : MISSING,
        Object.prototype.hasOwnProperty.call(server, key) ? server[key] : MISSING,
        [...path, key],
        context,
      );
      if (value !== MISSING) result[key] = value;
    }
    return result;
  }

  if (same(local, base)) return clone(server);
  if (same(server, base)) return clone(local);

  if (field === "updatedAt" && typeof local === "string" && typeof server === "string") {
    return new Date(local).getTime() >= new Date(server).getTime() ? local : server;
  }

  return recordConflict(context, path, local, server);
}

/**
 * Removes device-only navigation and composing state from the authoritative
 * snapshot. These fields remain available in React, but never create a D1
 * revision or a cross-device conflict.
 */
export function durableStudioData(source) {
  const data = structuredClone(source);
  data.currentArticleId = "";
  data.currentOutlineId = "";
  Object.assign(data.settings, {
    theme: "light",
    editorFont: "sans",
    fontSize: 17,
    lineHeight: 1.8,
    contentWidth: 920,
    outlineExpanded: true,
    showArchived: false,
    openLastArticle: true,
  });
  for (const article of data.articles ?? []) {
    article.lastOutlineId = "";
    for (const chapter of article.chapters ?? []) {
      for (const outline of chapter.outlines ?? []) {
        outline.chat.activeSessionId = "";
        for (const session of outline.chat.sessions ?? []) {
          session.draft = "";
          session.lastReadMessageId = null;
          session.includePrevious = true;
          session.includeCharacters = true;
        }
      }
    }
  }
  return data;
}

function outlineIndex(data) {
  const result = new Map();
  for (const article of data?.articles ?? []) {
    for (const chapter of article.chapters ?? []) {
      for (const outline of chapter.outlines ?? []) result.set(outline.id, outline);
    }
  }
  return result;
}

function applyAiResultSemantics(base, local, server, merged) {
  const baseOutlines = outlineIndex(base);
  const localOutlines = outlineIndex(local);
  const serverOutlines = outlineIndex(server);
  const mergedOutlines = outlineIndex(merged);
  for (const [outlineId, mergedOutline] of mergedOutlines) {
    const baseOutline = baseOutlines.get(outlineId);
    const localOutline = localOutlines.get(outlineId);
    const serverOutline = serverOutlines.get(outlineId);
    if (!baseOutline || !localOutline || !serverOutline) continue;
    const baseVersionIds = new Set((baseOutline.versions ?? []).map((version) => version.id));
    const generatedCurrent = (serverOutline.versions ?? []).find((version) => Boolean(version.taskId) && !baseVersionIds.has(version.id)
      && version.id === serverOutline.currentVersionId
      && ["AI Generate", "AI Chat", "AI Review"].includes(version.source));
    const mergedBodyDiffersFromServer = mergedOutline.content !== serverOutline.content
      || mergedOutline.contentName !== serverOutline.contentName
      || !same(mergedOutline.contentOutlineSnapshot, serverOutline.contentOutlineSnapshot)
      || mergedOutline.manualExcellent !== serverOutline.manualExcellent
      || !same(mergedOutline.excellentFragments ?? [], serverOutline.excellentFragments ?? []);
    if (generatedCurrent && mergedBodyDiffersFromServer) mergedOutline.currentVersionId = localOutline.currentVersionId;

    const serverTitleChanged = serverOutline.title !== baseOutline.title
      || serverOutline.titleGenerationPending !== baseOutline.titleGenerationPending;
    const serverTitleIsAiResult = baseOutline.titleGenerationPending
      && !serverOutline.titleGenerationPending
      && String(serverOutline.title ?? "").trim()
      && (server.tasks ?? []).some((task) => task.outlineId === outlineId && task.state === "success");
    const mergedInvalidatesServerTitle = mergedOutline.title !== serverOutline.title || mergedOutline.plan !== serverOutline.plan;
    if (serverTitleChanged && serverTitleIsAiResult && mergedInvalidatesServerTitle) {
      mergedOutline.title = localOutline.title;
      mergedOutline.titleGenerationPending = localOutline.titleGenerationPending;
    }
  }
  return merged;
}

export function mergeStudioConflict(base, local, server) {
  const context = { conflicts: [], localRoot: local, serverRoot: server, preference: null };
  const merged = applyAiResultSemantics(base, local, server, mergeValue(base, local, server, [], context));
  return { merged, conflicts: context.conflicts };
}

export function resolveStudioConflict(base, local, server, preference) {
  const context = { conflicts: [], localRoot: local, serverRoot: server, preference };
  return applyAiResultSemantics(base, local, server, mergeValue(base, local, server, [], context));
}

/** Backward-compatible entry point used by older callers and tests. */
export function mergeAiManagedConflict(base, local, server) {
  const result = mergeStudioConflict(base, local, server);
  return result.conflicts.length ? null : result.merged;
}
