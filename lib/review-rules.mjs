export const MAX_REVIEW_RULES = 100;
export const MAX_REVIEW_RULE_CONTENT = 20000;
export const MAX_REVIEW_RULE_TOTAL = 100000;

// Templates are copied into each article once. An explicit [] stays empty.
export const DEFAULT_REVIEW_RULES = [
  { key: "mixed-english", title: "不必要的中英文混用", content: "修正中文正文中无必要夹杂的英文表达；保留人物名、品牌、专有名词、URL、代码、型号和有意设计的英文对白。" },
  { key: "repeated-scene", title: "重复场景描写", content: "检查本次审校范围内重复的场景描写；保留第一次或最有效的完整描写，后续只保留推进情节或新增的信息。" },
  { key: "repeated-entity", title: "重复人物及事物描写", content: "检查人物外貌、物品和其他事物的重复描写；保留必要的呼应与伏笔，将无新增信息的重复介绍删除或压缩。" },
  { key: "story-consistency", title: "情节与人物一致性", content: "遵守生成要求、大纲和人物事实；不新增、删除或改变情节事实、人物关系和叙事顺序。" },
  { key: "minimal-edit", title: "保留有效内容与有意呼应", content: "保留与已发现问题无关的内容，避免无依据改动情节。刻意呼应、伏笔、主题意象和角色有意义的回忆不属于无效重复，不得机械删除。" },
];

function requireText(value, label, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error(`${label}不能为空，且不能超过 ${maximum} 字符`);
  return value.trim();
}

export function createDefaultReviewRules(articleId, timestamp = "1970-01-01T00:00:00.000Z") {
  return DEFAULT_REVIEW_RULES.map(({ key, title, content }) => ({
    id: `review-rule:${articleId}:${key}`, title, content, archived: false, origin: "default", revision: 1, createdAt: timestamp, updatedAt: timestamp,
  }));
}

export function normalizeReviewRuleItems(value, articleId, legacyRules = "", timestamp = "1970-01-01T00:00:00.000Z") {
  if (value == null) {
    const defaults = createDefaultReviewRules(articleId, timestamp);
    if (typeof legacyRules === "string" && legacyRules.trim()) defaults.push({
      id: `review-rule:${articleId}:legacy`, title: "原通用 Review 规则", content: legacyRules.trim().slice(0, MAX_REVIEW_RULE_CONTENT),
      archived: false, origin: "legacy", revision: 1, createdAt: timestamp, updatedAt: timestamp,
    });
    return defaults;
  }
  if (!Array.isArray(value) || value.length > MAX_REVIEW_RULES) throw new Error(`Review 规则必须为列表，最多 ${MAX_REVIEW_RULES} 条`);
  const ids = new Set();
  let total = 0;
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Review 规则格式无效");
    const id = requireText(item.id, "规则 ID", 300);
    const title = requireText(item.title, "规则名称", 120);
    const content = requireText(item.content, "规则内容", MAX_REVIEW_RULE_CONTENT);
    total += title.length + content.length;
    if (ids.has(id)) throw new Error("Review 规则 ID 重复");
    if (total > MAX_REVIEW_RULE_TOTAL) throw new Error(`Review 规则总长度不能超过 ${MAX_REVIEW_RULE_TOTAL} 字符`);
    if (typeof item.archived !== "boolean" || !["default", "custom", "legacy", "preset"].includes(item.origin) || !Number.isSafeInteger(item.revision) || item.revision < 1) throw new Error("Review 规则状态或版本无效");
    if (typeof item.createdAt !== "string" || !Number.isFinite(Date.parse(item.createdAt)) || typeof item.updatedAt !== "string" || !Number.isFinite(Date.parse(item.updatedAt))) throw new Error("Review 规则时间无效");
    ids.add(id);
    return { id, title, content, archived: item.archived, origin: item.origin, revision: item.revision, createdAt: item.createdAt, updatedAt: item.updatedAt };
  });
}

export function articleReviewRules(article) {
  return normalizeReviewRuleItems(article.reviewRuleItems, article.id, article.reviewRules, article.createdAt);
}

export function createReviewRuleSnapshot(article, instruction = "", requirements = []) {
  const rules = articleReviewRules(article).filter((rule) => !rule.archived).map(({ id, title, content, revision }) => ({ id, title, content, revision }));
  // Compatibility for older API callers. These are explicit run selections,
  // never globally enabled presets or hidden defaults.
  requirements.forEach((content, index) => rules.push({ id: `run-preset-${index + 1}`, title: `本次选用要求 ${index + 1}`, content, revision: 1 }));
  return normalizeReviewRuleSnapshot({ version: 1, rules, instruction });
}

export function normalizeReviewRuleSnapshot(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.rules) || value.rules.length > MAX_REVIEW_RULES + 20 || typeof value.instruction !== "string" || value.instruction.length > MAX_REVIEW_RULE_CONTENT) throw new Error("Review 规则快照无效");
  const ids = new Set();
  let total = 0;
  const rules = value.rules.map((rule) => {
    if (!rule || !Number.isSafeInteger(rule.revision) || rule.revision < 1) throw new Error("Review 规则快照版本无效");
    const id = requireText(rule.id, "规则 ID", 300);
    const title = requireText(rule.title, "规则名称", 120);
    const content = requireText(rule.content, "规则内容", MAX_REVIEW_RULE_CONTENT);
    total += title.length + content.length;
    if (ids.has(id) || total > MAX_REVIEW_RULE_TOTAL + 40000) throw new Error("Review 规则快照重复或过长");
    ids.add(id);
    return { id, title, content, revision: rule.revision };
  });
  return { version: 1, rules, instruction: value.instruction.trim() };
}

export function reviewRulesText(snapshot) {
  return snapshot.rules.map((rule) => `${rule.title}（v${rule.revision}）\n${rule.content}`).join("\n\n");
}

export function hasReviewRules(snapshot) {
  return snapshot.rules.length > 0 || Boolean(snapshot.instruction.trim());
}
