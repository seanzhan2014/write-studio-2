export const SCENE_FIELDS = {
  purpose: "本场作用", entry: "开场状态", goal: "人物目标", obstacle: "阻力与冲突",
  actions: "行动与因果", outcome: "结果与变化", knowledge: "认知与信息揭示",
  transition: "承接与收束", treatment: "展开与篇幅",
} as const;

export type ScenePlan = {
  anchors: Array<{ id: string; fact: string; source: string }>;
  creativeSpace: string;
  unresolved: string[];
  scenes: Array<{ id: string; anchors: string[] } & Record<keyof typeof SCENE_FIELDS, string>>;
};
export type PlanIssue = { sceneId: string; problem: string; evidence: string; fix: string };
export type PlanCheck = { briefDigest: string; checkedAt: string };

const textSchema = { type: "string" } as const;
export const SCENE_PLAN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["anchors", "creativeSpace", "unresolved", "scenes"],
  properties: {
    anchors: { type: "array", minItems: 1, maxItems: 60, items: {
      type: "object", additionalProperties: false, required: ["id", "fact", "source"],
      properties: { id: textSchema, fact: textSchema, source: textSchema },
    } },
    creativeSpace: textSchema,
    unresolved: { type: "array", maxItems: 20, items: textSchema },
    scenes: { type: "array", minItems: 1, maxItems: 30, items: {
      type: "object", additionalProperties: false, required: ["id", "anchors", ...Object.keys(SCENE_FIELDS)],
      properties: { id: textSchema, anchors: { type: "array", maxItems: 60, items: textSchema }, ...Object.fromEntries(Object.keys(SCENE_FIELDS).map(key => [key, textSchema])) },
    } },
  },
} as const;
export const PLAN_CHECK_RESPONSE_FORMAT = {
  type: "json_schema", json_schema: {
    name: "writer_studio_preparation_check", strict: true,
    schema: { type: "object", additionalProperties: false, required: ["issues"], properties: {
      issues: { type: "array", maxItems: 12, items: {
        type: "object", additionalProperties: false, required: ["sceneId", "problem", "evidence", "fix"],
        properties: { sceneId: textSchema, problem: textSchema, evidence: textSchema, fix: textSchema },
      } },
    } },
  },
} as const;

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} 必须为对象`);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${field} 必须为非空文本，且不超过 ${max} 字符`);
  return value.trim();
}
function list(value: unknown, field: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${field} 数量须为 ${min}–${max}`);
  return value;
}

export function parseScenePlan(value: unknown): ScenePlan {
  const raw = record(value, "plan");
  const anchorIds = new Set<string>(), sceneIds = new Set<string>();
  const anchors = list(raw.anchors, "plan.anchors", 60, 1).map((value, index) => {
    const item = record(value, `plan.anchors[${index}]`);
    const id = text(item.id, "情节编号", 80);
    if (anchorIds.has(id)) throw new Error(`情节编号重复：${id}`);
    anchorIds.add(id);
    return { id, fact: text(item.fact, "固定情节"), source: text(item.source, "事实来源") };
  });
  const covered = new Set<string>();
  const scenes = list(raw.scenes, "plan.scenes", 30, 1).map((value, index) => {
    const item = record(value, `plan.scenes[${index}]`);
    const id = text(item.id, "场景编号", 80);
    if (sceneIds.has(id)) throw new Error(`场景编号重复：${id}`);
    sceneIds.add(id);
    const refs = list(item.anchors, `场景 ${id} 的情节关联`, 60).map(value => text(value, "情节关联", 80));
    if (new Set(refs).size !== refs.length) throw new Error(`场景 ${id} 存在重复情节关联`);
    for (const ref of refs) {
      if (!anchorIds.has(ref)) throw new Error(`场景 ${id} 引用了不存在的情节 ${ref}`);
      covered.add(ref);
    }
    const fields = Object.fromEntries(Object.keys(SCENE_FIELDS).map(key => [key, text(item[key], `场景 ${id}.${key}`)])) as Record<keyof typeof SCENE_FIELDS, string>;
    return { id, anchors: refs, ...fields };
  });
  const missing = anchors.filter(anchor => !covered.has(anchor.id));
  if (missing.length) throw new Error(`场景计划遗漏固定情节：${missing.map(anchor => anchor.id).join("、")}`);
  return { anchors, scenes, creativeSpace: text(raw.creativeSpace, "允许创作的范围", 4000), unresolved: list(raw.unresolved, "未决项", 20).map(value => text(value, "未决项")) };
}

export function renderScenePlan(plan: ScenePlan) {
  return [
    "固定情节与来源", ...plan.anchors.map(anchor => `${anchor.id}. ${anchor.fact}\n来源：${anchor.source}`),
    `创作边界\n${plan.creativeSpace}`, `未决项\n${plan.unresolved.join("\n") || "无"}`,
    "场景计划", ...plan.scenes.map(scene => [`场景 ${scene.id} · 情节 ${scene.anchors.join("、") || "衔接"}`, ...Object.entries(SCENE_FIELDS).map(([key, label]) => `${label}：${scene[key as keyof typeof SCENE_FIELDS]}`)].join("\n")),
  ].join("\n\n");
}

export function parsePlanIssues(value: string): PlanIssue[] {
  const raw = record(JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")), "计划检查");
  return list(raw.issues, "计划问题", 12).map(value => {
    const item = record(value, "计划问题");
    return { sceneId: text(item.sceneId, "场景定位", 80), problem: text(item.problem, "具体问题"), evidence: text(item.evidence, "问题依据"), fix: text(item.fix, "修改办法") };
  });
}

export async function preparationBriefDigest(brief: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(brief));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
