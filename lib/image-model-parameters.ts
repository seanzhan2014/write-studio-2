export type ImageParameters = Record<string, string | number | boolean>;
export type ImageParameterContext = { adapterKind?: string; baseUrl?: string; modelId?: string };
export type ImageParameterRule = { type: "number" | "string" | "boolean"; min?: number; max?: number; integer?: boolean; multipleOf?: number; values?: string[] };
const number = (min: number, max: number, integer = false): ImageParameterRule => ({ type: "number", min, max, integer });
const enumeration = (...values: string[]): ImageParameterRule => ({ type: "string", values });
const seed = number(0, Number.MAX_SAFE_INTEGER, true);
const dimension = { ...number(64, 2048, true), multipleOf: 16 };
const comfySamplers = "euler euler_ancestral euler_cfg_pp euler_ancestral_cfg_pp heun heunpp2 dpm_2 dpm_2_ancestral lms dpm_fast dpm_adaptive dpmpp_2s_ancestral dpmpp_2s_ancestral_cfg_pp dpmpp_sde dpmpp_sde_gpu dpmpp_2m dpmpp_2m_cfg_pp dpmpp_2m_sde dpmpp_2m_sde_gpu ddpm lcm ipndm ipndm_v deis ddim uni_pc uni_pc_bh2 res_multistep er_sde".split(" ");

export function imageParameterProfile(context: ImageParameterContext) {
  let host = ""; try { host = new URL(context.baseUrl || "").hostname; } catch { /* Explicit adapter still works. */ }
  if (context.adapterKind === "civitai" || ["civitai.com", "www.civitai.com", "orchestration.civitai.com"].includes(host)) return context.modelId?.toLowerCase().includes(":mossimage:") ? "moss" : "sd";
  return context.adapterKind === "spicyapi" || host === "api.spicyapi.ai" ? "spicy" : "compatible";
}

export function imageParameterRules(context: ImageParameterContext): Record<string, ImageParameterRule> {
  switch (imageParameterProfile(context)) {
    case "moss": return { steps: number(1, 150, true), cfgScale: number(1, 30), seed, sampler: enumeration(...comfySamplers), scheduler: enumeration("normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform", "beta"), width: dimension, height: dimension };
    case "sd": return { steps: number(1, 150, true), cfgScale: number(0, 30), seed, sampleMethod: enumeration("euler", "heun", "dpm2", "dpm++2s_a", "dpm++2m", "dpm++2mv2", "ipndm", "ipndm_v", "ddim_trailing", "euler_a", "lcm", "res_multistep", "res_2s", "tcd", "er_sde"), schedule: enumeration("simple", "discrete", "karras", "exponential", "ays", "bong_tangent", "gits", "sgm_uniform", "smoothstep", "kl_optimal", "lcm"), clipSkip: number(0, 12, true), uCache: enumeration("off", "normal"), width: dimension, height: dimension };
    case "spicy": return { seed, steps: number(1, 150, true), num_inference_steps: number(1, 150, true), guidance_scale: number(0, 30), cfg_scale: number(0, 30), width: dimension, height: dimension, enable_prompt_expansion: { type: "boolean" } };
    default: return { seed, quality: enumeration("auto", "low", "medium", "high", "standard", "hd"), style: enumeration("natural", "vivid"), background: enumeration("auto", "transparent", "opaque"), output_format: enumeration("png", "jpeg", "webp"), output_compression: number(0, 100, true) };
  }
}

export function validateImageParameters(value: unknown, context?: ImageParameterContext): ImageParameters {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error("图片高级参数必须为参数对象");
  const rules = context ? imageParameterRules(context) : Object.assign({}, ...[{ adapterKind: "civitai", modelId: "urn:air:mossimage:" }, { adapterKind: "civitai" }, { adapterKind: "spicyapi" }, {}].map(imageParameterRules));
  const entries = Object.entries(value);
  if (entries.length > 24) throw new Error("图片高级参数不能超过 24 项");
  const result: ImageParameters = {};
  for (const [key, item] of entries) {
    const rule = Object.hasOwn(rules, key) ? rules[key] : undefined;
    if (!rule) throw new Error(`不支持图片参数「${key}」。可用参数：${Object.keys(rules).join(", ")}`);
    if (typeof item !== rule.type || typeof item === "number" && (!Number.isFinite(item) || item < rule.min! || item > rule.max! || rule.integer && !Number.isSafeInteger(item) || rule.multipleOf && item % rule.multipleOf !== 0) || typeof item === "string" && (item.length > 200 || rule.values && !rule.values.includes(item))) throw new Error(`图片参数「${key}」的值无效${rule.values ? `，可选值：${rule.values.join(", ")}` : rule.min !== undefined ? `，范围 ${rule.min}–${rule.max}${rule.multipleOf ? `，须为 ${rule.multipleOf} 的倍数` : rule.integer ? "，须为整数" : ""}` : ""}`);
    result[key] = item as string | number | boolean;
  }
  return result;
}

export function parseImageParameterText(text: string, context: ImageParameterContext): ImageParameters {
  if (text.length > 4000) throw new Error("额外图片参数不能超过 4,000 字符");
  const tokens: string[] = []; let token = "", quoted = false, escaped = false;
  for (const character of text) {
    if (escaped) { token += character; escaped = false; continue; }
    if (quoted && character === "\\") { token += character; escaped = true; continue; }
    if (character === '"') quoted = !quoted;
    if (!quoted && /[,，\n]/u.test(character)) { tokens.push(token); token = ""; } else token += character;
  }
  if (quoted) throw new Error("额外参数的双引号未闭合");
  tokens.push(token);
  const parameters: ImageParameters = {};
  for (const token of tokens.map(value => value.trim()).filter(Boolean)) {
    const match = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(token);
    if (!match) throw new Error(`额外参数格式无效：${token}。请使用 参数名=值，并用逗号分隔`);
    const [, key, rawValue] = match;
    if (Object.hasOwn(parameters, key)) throw new Error(`图片参数「${key}」重复，请只填写一次`);
    const raw = rawValue.trim();
    let value: unknown = raw;
    if (raw.startsWith('"') || /^(?:true|false|-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/i.test(raw)) {
      try { value = JSON.parse(raw); } catch { throw new Error(`图片参数「${key}」的值无效`); }
    }
    parameters[key] = value as string | number | boolean;
  }
  return validateImageParameters(parameters, context);
}

export function formatImageParameterText(parameters: ImageParameters) {
  return Object.entries(parameters).map(([key, value]) => `${key}=${typeof value === "string" ? JSON.stringify(value) : String(value)}`).join(", ");
}

export function defaultImageParameters(context: ImageParameterContext): ImageParameters {
  const profile = imageParameterProfile(context);
  if (profile === "moss") {
    const turbo = /:civitai:3018302@3426693(?:\+|$)/i.test(context.modelId || "");
    return { steps: turbo ? 12 : 25, cfgScale: turbo ? 1 : 2.5, sampler: turbo ? "heunpp2" : "er_sde", scheduler: "simple" };
  }
  if (profile === "sd") return { steps: 20, cfgScale: 7, sampleMethod: "euler", schedule: "discrete" };
  return {};
}
