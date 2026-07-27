export function moveOutlineBetweenChapters(chapters, sourceId, targetId, placement) {
  if (sourceId === targetId) return chapters;
  const next = chapters.map((chapter) => ({ ...chapter, outlines: [...chapter.outlines] }));
  let source;
  for (const chapter of next) {
    const sourceIndex = chapter.outlines.findIndex((item) => item.id === sourceId);
    if (sourceIndex >= 0) [source] = chapter.outlines.splice(sourceIndex, 1);
  }
  if (!source) return chapters;
  for (const chapter of next) {
    const targetIndex = chapter.outlines.findIndex((item) => item.id === targetId);
    if (targetIndex < 0) continue;
    chapter.outlines.splice(targetIndex + (placement === "after" ? 1 : 0), 0, source);
    return next;
  }
  return chapters;
}

export function moveOutlineToChapterEnd(chapters, sourceId, targetChapterId) {
  const sourceChapter = chapters.find((chapter) => chapter.outlines.some((outline) => outline.id === sourceId));
  const targetChapter = chapters.find((chapter) => chapter.id === targetChapterId);
  if (!sourceChapter || !targetChapter) return chapters;
  if (sourceChapter.id === targetChapterId && sourceChapter.outlines.at(-1)?.id === sourceId) return chapters;

  const next = chapters.map((chapter) => ({ ...chapter, outlines: [...chapter.outlines] }));
  let source;
  for (const chapter of next) {
    const sourceIndex = chapter.outlines.findIndex((outline) => outline.id === sourceId);
    if (sourceIndex >= 0) [source] = chapter.outlines.splice(sourceIndex, 1);
  }
  if (!source) return chapters;
  next.find((chapter) => chapter.id === targetChapterId).outlines.push(source);
  return next;
}
