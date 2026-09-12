export const NAMING_STYLE_OPTIONS = [
  { value: "modern", label: "现代简洁", instruction: "使用现代中文，语言简洁清晰。" },
  { value: "classical", label: "古风", instruction: "使用古典中文语感和含蓄意象，避免明显的现代口语。" },
  { value: "poetic", label: "诗意", instruction: "使用凝练的文学意象和有余韵的表达。" },
  { value: "humorous", label: "幽默轻松", instruction: "使用轻松、有反差感的表达，可以适度口语化，但不要低俗。" },
  { value: "restrained", label: "冷峻克制", instruction: "用词短促克制，减少修饰，保留情绪张力。" },
  { value: "custom", label: "自定义", instruction: "遵循用户提供的自定义语言风格。" },
] as const;

export const NAMING_EXPRESSION_OPTIONS = [
  { value: "direct", label: "直接点题", instruction: "直接呈现核心事件、人物选择或冲突，让读者一眼理解重点。" },
  { value: "implicit", label: "含蓄隐晦", instruction: "不直接复述事件和结局，通过暗示、双关或侧面意象表达。" },
  { value: "suspense", label: "悬念留白", instruction: "突出疑问、异常或未完成的行动，不提前揭示结果。" },
  { value: "symbolic", label: "意象象征", instruction: "选择与情节相呼应的物象或环境意象承载含义。" },
  { value: "character", label: "人物导向", instruction: "聚焦人物处境、欲望、决定或关系变化。" },
  { value: "event", label: "事件导向", instruction: "聚焦本段最关键的行动、发现、冲突或转折。" },
  { value: "custom", label: "自定义", instruction: "遵循用户提供的自定义表达要求。" },
] as const;

export const NAMING_FORMAT_OPTIONS = [
  { value: "range", label: "字数范围" },
  { value: "five", label: "五言" },
  { value: "seven", label: "七言" },
  { value: "cipai", label: "词牌风格" },
] as const;

export const CIPAI_OPTIONS = [
  { value: "rumengling", label: "如梦令", instruction: "参考《如梦令》短促、回环、带有余韵的节奏。" },
  { value: "huanxisha", label: "浣溪沙", instruction: "参考《浣溪沙》流丽、均衡、情景交融的节奏。" },
  { value: "dielianhua", label: "蝶恋花", instruction: "参考《蝶恋花》婉转、层层推进、情绪浓郁的节奏。" },
  { value: "linjiangxian", label: "临江仙", instruction: "参考《临江仙》舒展、苍茫、适合叙事回望的节奏。" },
  { value: "qingpingle", label: "清平乐", instruction: "参考《清平乐》轻灵、清雅、画面感鲜明的节奏。" },
  { value: "xijiangyue", label: "西江月", instruction: "参考《西江月》明快、转折清楚、富有叙述感的节奏。" },
  { value: "yijiangnan", label: "忆江南", instruction: "参考《忆江南》短小、明净、具有记忆感的节奏。" },
  { value: "busuanzi", label: "卜算子", instruction: "参考《卜算子》凝练、孤峭、带有判断或寄托的节奏。" },
] as const;

export type NamingStyle = typeof NAMING_STYLE_OPTIONS[number]["value"];
export type NamingExpression = typeof NAMING_EXPRESSION_OPTIONS[number]["value"];
export type NamingFormat = typeof NAMING_FORMAT_OPTIONS[number]["value"];
export type Cipai = typeof CIPAI_OPTIONS[number]["value"];

export type NamingProfile = {
  style: NamingStyle;
  expression: NamingExpression;
  format: NamingFormat;
  minCharacters: number;
  maxCharacters: number;
  lineCount: number;
  cipai: Cipai;
  customStyle: string;
  customExpression: string;
};

export const DEFAULT_CHAPTER_NAMING_PROFILE: NamingProfile = {
  style: "modern",
  expression: "direct",
  format: "range",
  minCharacters: 4,
  maxCharacters: 12,
  lineCount: 1,
  cipai: "rumengling",
  customStyle: "",
  customExpression: "",
};

export const DEFAULT_OUTLINE_NAMING_PROFILE: NamingProfile = {
  ...DEFAULT_CHAPTER_NAMING_PROFILE,
};

function isStyle(value: unknown): value is NamingStyle {
  return NAMING_STYLE_OPTIONS.some((item) => item.value === value);
}

function isExpression(value: unknown): value is NamingExpression {
  return NAMING_EXPRESSION_OPTIONS.some((item) => item.value === value);
}

function isFormat(value: unknown): value is NamingFormat {
  return NAMING_FORMAT_OPTIONS.some((item) => item.value === value);
}

function isCipai(value: unknown): value is Cipai {
  return CIPAI_OPTIONS.some((item) => item.value === value);
}

export function normalizeNamingProfile(value: unknown, fallback: NamingProfile): NamingProfile {
  const source = value && typeof value === "object" ? value as Omit<Partial<NamingProfile>, "style"> & { style?: unknown } : {};
  const minimum = Math.max(1, Math.min(80, Math.round(Number(source.minCharacters) || fallback.minCharacters)));
  const maximum = Math.max(minimum, Math.min(80, Math.round(Number(source.maxCharacters) || fallback.maxCharacters)));
  const legacySuspenseStyle = source.style === "suspense";
  return {
    style: isStyle(source.style) ? source.style : legacySuspenseStyle ? "modern" : fallback.style,
    expression: isExpression(source.expression) ? source.expression : legacySuspenseStyle ? "suspense" : fallback.expression,
    format: isFormat(source.format) ? source.format : fallback.format,
    minCharacters: minimum,
    maxCharacters: maximum,
    lineCount: Math.max(1, Math.min(4, Math.round(Number(source.lineCount) || fallback.lineCount))),
    cipai: isCipai(source.cipai) ? source.cipai : fallback.cipai,
    customStyle: String(source.customStyle ?? "").trim().slice(0, 500),
    customExpression: String(source.customExpression ?? "").trim().slice(0, 500),
  };
}

function cleanGeneratedLine(value: string) {
  return value.trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^(?:[-*•]|\d+[.)、])\s*/, "")
    .replace(/^[“”‘’'"《》【】]+|[“”‘’'"《》【】]+$/g, "")
    .replace(/^第.+?[章节回篇]\s*[·:：、-]?\s*/, "")
    .trim();
}

function stripCipaiPrefix(value: string) {
  for (const tune of CIPAI_OPTIONS) {
    const prefix = new RegExp(`^(?:词牌名?[：:]\\s*)?[《【“\"]?${tune.label}[》】”\"]?[\\s·:：、,，-]+`);
    if (prefix.test(value)) return value.replace(prefix, "");
  }
  return value;
}

export function normalizeGeneratedName(value: unknown, maximum: number, profile?: NamingProfile) {
  const normalizedProfile = profile ? normalizeNamingProfile(profile, DEFAULT_OUTLINE_NAMING_PROFILE) : undefined;
  const raw = String(value ?? "").trim().replace(/^```[^\n]*\n?/i, "").replace(/\n?```\s*$/, "");
  const lines = raw.split(/\r?\n/).map(cleanGeneratedLine).filter(Boolean);
  let name = normalizedProfile && normalizedProfile.format !== "range" ? lines.join("，") : lines[0] ?? "";
  if (normalizedProfile?.format === "cipai") name = stripCipaiPrefix(name);
  if (normalizedProfile && normalizedProfile.format !== "range") {
    name = name.replace(/[。；;!?！？]+/g, "，").replace(/[,、]+/g, "，").replace(/，+/g, "，").replace(/^，|，$/g, "");
  }
  name = name.replace(/\s+/g, normalizedProfile && normalizedProfile.format !== "range" ? "" : " ").trim();
  return Array.from(name).slice(0, maximum).join("");
}

export function namingCharacterCount(value: string) {
  return Array.from(value.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "")).length;
}

export function namingProfileInstruction(profile: NamingProfile) {
  const normalized = normalizeNamingProfile(profile, DEFAULT_OUTLINE_NAMING_PROFILE);
  const style = NAMING_STYLE_OPTIONS.find((item) => item.value === normalized.style) ?? NAMING_STYLE_OPTIONS[0];
  const expression = NAMING_EXPRESSION_OPTIONS.find((item) => item.value === normalized.expression) ?? NAMING_EXPRESSION_OPTIONS[0];
  const tune = CIPAI_OPTIONS.find((item) => item.value === normalized.cipai) ?? CIPAI_OPTIONS[0];
  const styleInstruction = normalized.style === "custom" && normalized.customStyle ? normalized.customStyle : style.instruction;
  const expressionInstruction = normalized.expression === "custom" && normalized.customExpression ? normalized.customExpression : expression.instruction;
  const lineText = `${normalized.lineCount} 句，句间只使用中文逗号“，”连接，保存为单行，末尾不加标点`;
  const formatInstruction = normalized.format === "five"
    ? `生成${lineText}；每句必须恰好由 5 个汉字组成，不得包含其他标点、空格或数字。`
    : normalized.format === "seven"
      ? `生成${lineText}；每句必须恰好由 7 个汉字组成，不得包含其他标点、空格或数字。`
      : normalized.format === "cipai"
        ? `采用简化词牌风格。${tune.instruction}生成${lineText}；每句使用 2–12 个汉字。不严格要求平仄或完整词谱。词牌名“${tune.label}”只作为风格约束，绝对不要出现在结果中。`
        : `忽略空格和标点后，标题长度必须为 ${normalized.minCharacters}–${normalized.maxCharacters} 个字符。`;
  return `${styleInstruction}\n${expressionInstruction}\n${formatInstruction}\n只生成核心标题，不生成“第X章”“第X回”等编号前缀。`;
}

export function validateGeneratedName(value: string, profile: NamingProfile, maximum: number) {
  const normalized = normalizeNamingProfile(profile, DEFAULT_OUTLINE_NAMING_PROFILE);
  const name = normalizeGeneratedName(value, maximum, normalized);
  if (!name) return { valid: false as const, name, error: "模型没有返回名称" };
  if (normalized.format === "range") {
    const count = namingCharacterCount(name);
    if (count < normalized.minCharacters || count > normalized.maxCharacters) return { valid: false as const, name, error: `名称长度必须为 ${normalized.minCharacters}–${normalized.maxCharacters} 个字符` };
    return { valid: true as const, name };
  }
  const lines = name.split("，");
  if (lines.length !== normalized.lineCount) return { valid: false as const, name, error: `名称必须包含 ${normalized.lineCount} 句，并用中文逗号连接` };
  if (normalized.format === "five" && lines.some((line) => !/^\p{Script=Han}{5}$/u.test(line))) return { valid: false as const, name, error: "五言名称的每句必须恰好为 5 个汉字" };
  if (normalized.format === "seven" && lines.some((line) => !/^\p{Script=Han}{7}$/u.test(line))) return { valid: false as const, name, error: "七言名称的每句必须恰好为 7 个汉字" };
  if (normalized.format === "cipai" && lines.some((line) => !/^\p{Script=Han}{2,12}$/u.test(line))) return { valid: false as const, name, error: "词牌风格名称的每句必须为 2–12 个汉字" };
  if (normalized.format === "cipai" && CIPAI_OPTIONS.some((item) => name.includes(item.label))) return { valid: false as const, name, error: "词牌风格名称中不能显示词牌名" };
  return { valid: true as const, name };
}
