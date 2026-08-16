const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function outlineIndex(data) {
  const result = new Map();
  for (const article of data.articles ?? []) {
    for (const chapter of article.chapters ?? []) {
      for (const outline of chapter.outlines ?? []) result.set(outline.id, outline);
    }
  }
  return result;
}

function isServerGeneratedVersion(version) {
  const generatedResult = version?.source === "AI Generate" || version?.source === "AI Chat" || version?.source === "AI Review";
  const protectedGenerateInput = version?.source === "手动" && String(version?.name ?? "").startsWith("AI Generate 前 · ");
  return Boolean(version?.taskId) && (generatedResult || protectedGenerateInput);
}

/**
 * Rebase local edits over server-owned AI task progress. Returns null when the
 * server also changed user-editable data, so the real conflict remains visible.
 */
export function mergeAiManagedConflict(base, local, server) {
  if (!base || !local || !server || !Array.isArray(base.articles) || !Array.isArray(server.articles)) return null;

  const comparable = structuredClone(server);
  comparable.tasks = structuredClone(base.tasks ?? []);
  comparable.currentArticleId = base.currentArticleId;
  comparable.currentOutlineId = base.currentOutlineId;
  const baseArticles = new Map((base.articles ?? []).map((article) => [article.id, article]));
  for (const article of comparable.articles ?? []) {
    const baseArticle = baseArticles.get(article.id);
    if (baseArticle) article.lastOutlineId = baseArticle.lastOutlineId;
  }
  const baseOutlines = outlineIndex(base);
  const comparableOutlines = outlineIndex(comparable);
  const serverOutlines = outlineIndex(server);

  for (const [outlineId, serverOutline] of serverOutlines) {
    const baseOutline = baseOutlines.get(outlineId);
    const comparableOutline = comparableOutlines.get(outlineId);
    if (!baseOutline || !comparableOutline) return null;

    const baseVersions = new Map((baseOutline.versions ?? []).map((version) => [version.id, version]));
    const retainedVersions = (serverOutline.versions ?? []).filter((version) => baseVersions.has(version.id));
    const addedVersions = (serverOutline.versions ?? []).filter((version) => !baseVersions.has(version.id));
    if (retainedVersions.length !== baseVersions.size || retainedVersions.some((version) => !same(version, baseVersions.get(version.id))) || addedVersions.some((version) => !isServerGeneratedVersion(version))) return null;
    const generatedCurrent = addedVersions.find((version) => (version.source === "AI Generate" || version.source === "AI Chat" || version.source === "AI Review")
      && version.id === serverOutline.currentVersionId);
    const defaultChanged = serverOutline.defaultVersionId !== baseOutline.defaultVersionId;
    const currentChanged = serverOutline.currentVersionId !== baseOutline.currentVersionId
      || serverOutline.contentName !== baseOutline.contentName
      || serverOutline.content !== baseOutline.content
      || !same(serverOutline.contentOutlineSnapshot, baseOutline.contentOutlineSnapshot)
      || serverOutline.manualExcellent !== baseOutline.manualExcellent
      || !same(serverOutline.excellentFragments ?? [], baseOutline.excellentFragments ?? []);
    if (defaultChanged || (currentChanged && !generatedCurrent)) return null;

    const titleChanged = serverOutline.title !== baseOutline.title || serverOutline.titleGenerationPending !== baseOutline.titleGenerationPending;
    const hasCompletedTask = (server.tasks ?? []).some((task) => task.outlineId === outlineId && task.state === "success");
    if (titleChanged && !(baseOutline.titleGenerationPending && !serverOutline.titleGenerationPending && String(serverOutline.title ?? "").trim() && hasCompletedTask)) return null;

    comparableOutline.versions = structuredClone(baseOutline.versions ?? []);
    comparableOutline.state = baseOutline.state;
    if (generatedCurrent) {
      comparableOutline.currentVersionId = baseOutline.currentVersionId;
      comparableOutline.contentName = baseOutline.contentName;
      comparableOutline.content = baseOutline.content;
      comparableOutline.contentOutlineSnapshot = structuredClone(baseOutline.contentOutlineSnapshot);
      comparableOutline.manualExcellent = baseOutline.manualExcellent;
      comparableOutline.excellentFragments = structuredClone(baseOutline.excellentFragments);
    }
    if (titleChanged) {
      comparableOutline.title = baseOutline.title;
      comparableOutline.titleGenerationPending = baseOutline.titleGenerationPending;
    }
    if ((addedVersions.length || titleChanged || serverOutline.state !== baseOutline.state) && serverOutline.updatedAt !== baseOutline.updatedAt) comparableOutline.updatedAt = baseOutline.updatedAt;
  }

  if (!same(comparable, base)) return null;

  const merged = structuredClone(local);
  const mergedOutlines = outlineIndex(merged);
  for (const [outlineId, serverOutline] of serverOutlines) {
    const baseOutline = baseOutlines.get(outlineId);
    const localOutline = mergedOutlines.get(outlineId);
    if (!baseOutline || !localOutline) continue;
    localOutline.state = serverOutline.state;

    const baseVersionIds = new Set((baseOutline.versions ?? []).map((version) => version.id));
    const localVersionIds = new Set((localOutline.versions ?? []).map((version) => version.id));
    const serverAdditions = (serverOutline.versions ?? []).filter((version) => !baseVersionIds.has(version.id) && !localVersionIds.has(version.id));
    if (serverAdditions.length) localOutline.versions = [...structuredClone(serverAdditions), ...(localOutline.versions ?? [])];
    const serverGeneratedCurrent = serverAdditions.find((version) => (version.source === "AI Generate" || version.source === "AI Chat" || version.source === "AI Review")
      && version.id === serverOutline.currentVersionId);
    const localChangedCurrent = localOutline.currentVersionId !== baseOutline.currentVersionId
      || localOutline.contentName !== baseOutline.contentName
      || localOutline.content !== baseOutline.content
      || !same(localOutline.contentOutlineSnapshot, baseOutline.contentOutlineSnapshot)
      || localOutline.manualExcellent !== baseOutline.manualExcellent
      || !same(localOutline.excellentFragments ?? [], baseOutline.excellentFragments ?? []);
    if (serverGeneratedCurrent && !localChangedCurrent) {
      localOutline.currentVersionId = serverOutline.currentVersionId;
    }

    const serverTitleChanged = serverOutline.title !== baseOutline.title || serverOutline.titleGenerationPending !== baseOutline.titleGenerationPending;
    const localChangedTitleOrPlan = localOutline.title !== baseOutline.title || localOutline.plan !== baseOutline.plan;
    if (serverTitleChanged && !localChangedTitleOrPlan) {
      localOutline.title = serverOutline.title;
      localOutline.titleGenerationPending = serverOutline.titleGenerationPending;
    }
  }

  const baseTasks = new Map((base.tasks ?? []).map((task) => [task.id, task]));
  const localTasks = new Map((local.tasks ?? []).map((task) => [task.id, task]));
  const mergedTasks = (server.tasks ?? []).map((serverTask) => {
    const baseTask = baseTasks.get(serverTask.id);
    const localTask = localTasks.get(serverTask.id);
    return baseTask && localTask && !same(localTask, baseTask) ? structuredClone(localTask) : structuredClone(serverTask);
  });
  const mergedTaskIds = new Set(mergedTasks.map((task) => task.id));
  for (const localTask of local.tasks ?? []) if (!mergedTaskIds.has(localTask.id)) mergedTasks.push(structuredClone(localTask));
  merged.tasks = mergedTasks.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  return merged;
}
