export class AiReviewResultError extends Error {
  constructor(message) {
    super(message);
    this.name = "AiReviewResultError";
  }
}

export function createReviewBlocks(outlineId, outlineIndex, text) {
  const source = String(text ?? "");
  const blocks = [];
  const separator = /(?:\r?\n){2,}/g;
  let start = 0;
  let match;
  while ((match = separator.exec(source))) {
    const end = match.index + match[0].length;
    blocks.push({ id: `o${String(outlineIndex + 1).padStart(3, "0")}b${String(blocks.length + 1).padStart(5, "0")}`, outlineId, start, end, text: source.slice(start, end) });
    start = end;
  }
  if (start < source.length || blocks.length === 0) {
    blocks.push({ id: `o${String(outlineIndex + 1).padStart(3, "0")}b${String(blocks.length + 1).padStart(5, "0")}`, outlineId, start, end: source.length, text: source.slice(start) });
  }
  return blocks;
}

export function reviewSourceDigestInput(chapterId, outlines) {
  return JSON.stringify({
    chapterId,
    outlines: outlines.map((outline) => ({
      id: outline.id,
      title: outline.title,
      plan: outline.plan,
      name: outline.name,
      text: outline.text,
      settings: outline.settings,
    })),
  });
}

export async function reviewSourceDigest(chapterId, outlines) {
  const bytes = new TextEncoder().encode(reviewSourceDigestInput(chapterId, outlines));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function parseReviewResponse(value) {
  let payload = value;
  if (typeof payload === "string") {
    const plain = payload.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try { payload = JSON.parse(plain); } catch { throw new AiReviewResultError("AI Review 返回的 JSON 无法解析"); }
  }
  const record = object(payload);
  if (!record || record.version !== 1 || typeof record.chapterId !== "string" || typeof record.sourceDigest !== "string" || !Array.isArray(record.edits)) {
    throw new AiReviewResultError("AI Review 返回结构不完整");
  }
  if (record.edits.length > 5000) throw new AiReviewResultError("AI Review 返回的修改数量过多");
  const edits = record.edits.map((item) => {
    const edit = object(item);
    if (!edit || typeof edit.outlineId !== "string" || typeof edit.fromBlockId !== "string" || typeof edit.toBlockId !== "string" || typeof edit.replacement !== "string") {
      throw new AiReviewResultError("AI Review 包含无效修改项");
    }
    return {
      outlineId: edit.outlineId,
      fromBlockId: edit.fromBlockId,
      toBlockId: edit.toBlockId,
      replacement: edit.replacement,
      ruleIds: Array.isArray(edit.ruleIds) ? edit.ruleIds.map(String).slice(0, 20) : [],
    };
  });
  return { version: 1, chapterId: record.chapterId, sourceDigest: record.sourceDigest, edits };
}

export function applyReviewEdits(outlines, edits) {
  const outlineMap = new Map(outlines.map((outline) => [outline.id, outline]));
  const blockMap = new Map();
  const blocksByOutline = new Map();
  outlines.forEach((outline, outlineIndex) => {
    const blocks = createReviewBlocks(outline.id, outlineIndex, outline.text);
    blocksByOutline.set(outline.id, blocks);
    blocks.forEach((block, index) => blockMap.set(block.id, { ...block, index }));
  });
  const ranges = new Map();
  for (const edit of edits) {
    const outline = outlineMap.get(edit.outlineId);
    const from = blockMap.get(edit.fromBlockId);
    const to = blockMap.get(edit.toBlockId);
    if (!outline || !from || !to || from.outlineId !== edit.outlineId || to.outlineId !== edit.outlineId || from.index > to.index) {
      throw new AiReviewResultError("AI Review 引用了不存在或跨正文的段落");
    }
    const items = ranges.get(edit.outlineId) ?? [];
    items.push({ start: from.start, end: to.end, replacement: edit.replacement });
    ranges.set(edit.outlineId, items);
  }
  const results = new Map();
  for (const outline of outlines) {
    const items = (ranges.get(outline.id) ?? []).sort((left, right) => left.start - right.start);
    for (let index = 1; index < items.length; index += 1) {
      if (items[index].start < items[index - 1].end) throw new AiReviewResultError("AI Review 返回了相互重叠的修改");
    }
    let text = outline.text;
    for (const item of [...items].reverse()) text = `${text.slice(0, item.start)}${item.replacement}${text.slice(item.end)}`;
    results.set(outline.id, text);
  }
  return results;
}
