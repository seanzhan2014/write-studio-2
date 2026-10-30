export type ImageParameterValue = string | number | boolean | null | ImageParameterValue[] | { [key: string]: ImageParameterValue };
export type ImageParameters = Record<string, ImageParameterValue>;
export type ImageParameterContext = { adapterKind?: string; baseUrl?: string; modelId?: string };
export type ImageParameterSuggestion = { type: "number" | "string" | "boolean"; values?: string[] };
const numeric: ImageParameterSuggestion = { type: "number" };
const enumeration = (...values: string[]): ImageParameterSuggestion => ({ type: "string", values });
const comfySamplers = "euler euler_ancestral euler_cfg_pp euler_ancestral_cfg_pp heun heunpp2 dpm_2 dpm_2_ancestral lms dpm_fast dpm_adaptive dpmpp_2s_ancestral dpmpp_2s_ancestral_cfg_pp dpmpp_sde dpmpp_sde_gpu dpmpp_2m dpmpp_2m_cfg_pp dpmpp_2m_sde dpmpp_2m_sde_gpu ddpm lcm ipndm ipndm_v deis ddim uni_pc uni_pc_bh2 res_multistep er_sde".split(" ");

export function imageParameterProfile(context: ImageParameterContext) {
  let host = ""; try { host = new URL(context.baseUrl || "").hostname; } catch { /* Explicit adapter still works. */ }
  if (context.adapterKind === "civitai" || ["civitai.com", "www.civitai.com", "orchestration.civitai.com"].includes(host)) return context.modelId?.toLowerCase().includes(":mossimage:") ? "moss" : "sd";
  return context.adapterKind === "spicyapi" || host === "api.spicyapi.ai" ? "spicy" : "compatible";
}

// Editor suggestions only: parameter names, ranges and enums belong to the provider.
export function imageParameterSuggestions(context: ImageParameterContext): Record<string, ImageParameterSuggestion> {
  switch (imageParameterProfile(context)) {
    case "moss": return { steps: numeric, cfgScale: numeric, seed: numeric, sampler: enumeration(...comfySamplers), scheduler: enumeration("normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform", "beta"), width: numeric, height: numeric };
    case "sd": return { steps: numeric, cfgScale: numeric, seed: numeric, sampleMethod: enumeration("euler", "heun", "dpm2", "dpm++2s_a", "dpm++2m", "dpm++2mv2", "ipndm", "ipndm_v", "ddim_trailing", "euler_a", "lcm", "res_multistep", "res_2s", "tcd", "er_sde"), schedule: enumeration("simple", "discrete", "karras", "exponential", "ays", "bong_tangent", "gits", "sgm_uniform", "smoothstep", "kl_optimal", "lcm"), clipSkip: numeric, uCache: enumeration("off", "normal"), width: numeric, height: numeric };
    case "spicy": return { seed: numeric, steps: numeric, num_inference_steps: numeric, guidance_scale: numeric, cfg_scale: numeric, width: numeric, height: numeric, enable_prompt_expansion: { type: "boolean" } };
    default: return { seed: numeric, quality: enumeration("auto", "low", "medium", "high", "standard", "hd"), style: enumeration("natural", "vivid"), background: enumeration("auto", "transparent", "opaque"), output_format: enumeration("png", "jpeg", "webp"), output_compression: numeric };
  }
}

// Validate JSON structure without restricting provider-defined semantics.
export function validateImageParameters(value: unknown, _context?: ImageParameterContext): ImageParameters {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error("图片高级参数必须为参数对象");
  const entries = Object.entries(value);
  if (entries.length > 128) throw new Error("图片高级参数不能超过 128 项");
  const checkValue = (item: unknown, key: string, depth: number): void => {
    if (depth > 12) throw new Error(`图片参数「${key}」的 JSON 嵌套过深`);
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item) && (!Number.isInteger(item) || Number.isSafeInteger(item))) return;
    if (Array.isArray(item)) { item.forEach(child => checkValue(child, key, depth + 1)); return; }
    if (typeof item === "object" && (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null)) {
      for (const [childKey, child] of Object.entries(item)) {
        if (["__proto__", "prototype", "constructor"].includes(childKey)) throw new Error(`图片参数「${key}」包含无效 JSON 属性`);
        checkValue(child, key, depth + 1);
      }
      return;
    }
    throw new Error(`图片参数「${key}」的值无效，请使用 JSON 值及可准确表示的有限数字`);
  };
  const result: ImageParameters = {};
  for (const [key, item] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key) || key.split(".").some(part => ["__proto__", "prototype", "constructor"].includes(part))) throw new Error(`图片参数名「${key}」格式无效`);
    checkValue(item, key, 0);
    result[key] = item as ImageParameterValue;
  }
  if (JSON.stringify(result).length > 16_000) throw new Error("图片高级参数不能超过 16,000 字符");
  return result;
}

export function parseImageParameterText(text: string, context: ImageParameterContext): ImageParameters {
  if (text.length > 4000) throw new Error("额外图片参数不能超过 4,000 字符");
  const tokens: string[] = [], brackets: string[] = []; let token = "", quoted = false, escaped = false;
  for (const character of text) {
    if (escaped) { token += character; escaped = false; continue; }
    if (quoted && character === "\\") { token += character; escaped = true; continue; }
    if (character === '"') quoted = !quoted;
    if (!quoted && ["[", "{"].includes(character)) brackets.push(character);
    if (!quoted && ["]", "}"].includes(character) && brackets.pop() !== (character === "]" ? "[" : "{")) throw new Error("额外参数的 JSON 括号不匹配");
    if (!quoted && !brackets.length && /[,，\n]/u.test(character)) { tokens.push(token); token = ""; } else token += character;
  }
  if (quoted) throw new Error("额外参数的双引号未闭合");
  if (brackets.length) throw new Error("额外参数的 JSON 括号未闭合");
  tokens.push(token);
  const parameters: ImageParameters = {};
  for (const token of tokens.map(value => value.trim()).filter(Boolean)) {
    const match = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*([\s\S]+)$/.exec(token);
    if (!match) throw new Error(`额外参数格式无效：${token}。请使用 参数名=值，并用逗号分隔`);
    const [, key, rawValue] = match;
    if (Object.hasOwn(parameters, key)) throw new Error(`图片参数「${key}」重复，请只填写一次`);
    const raw = rawValue.trim();
    let value: unknown = raw;
    if (/^["\[{]/.test(raw) || /^(?:null|true|false|-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/i.test(raw)) {
      try { value = JSON.parse(raw); } catch { throw new Error(`图片参数「${key}」的值无效`); }
    }
    Object.defineProperty(parameters, key, { value, enumerable: true, configurable: true, writable: true });
  }
  return validateImageParameters(parameters, context);
}

export function formatImageParameterText(parameters: ImageParameters) {
  return Object.entries(parameters).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(", ");
}

// Legacy unprefixed workflow names still resolve to their original location.
// New editor saves explicit prefixes so identical names can exist in both scopes.
const workflowParameterNames = new Set("metadata tags callbacks tips arguments nsfwLevel downloadPriority tier experimental allowMatureContent upgradeMode currencies fund ephemeral externalId".split(" "));
export function splitCivitaiParameters(parameters?: ImageParameters) {
  const input: ImageParameters = {}, workflow: ImageParameters = {}, query: ImageParameters = {};
  for (const [name, value] of Object.entries(validateImageParameters(parameters))) {
    const prefix = /^(input|workflow|query)\.(.+)$/.exec(name);
    const target = prefix ? prefix[1] === "workflow" ? workflow : prefix[1] === "query" ? query : input : workflowParameterNames.has(name) ? workflow : ["wait", "whatif", "hideMatureContent"].includes(name) ? query : input;
    const key = prefix ? prefix[2] : name;
    if (["input.", "workflow.", "query."].includes(name) || Object.hasOwn(target, key)) throw new Error(`Civitai 参数「${name}」格式无效或重复`);
    target[key] = value;
  }
  return { input, workflow, query };
}

export type ImageParameterDraft = { values: Record<string, string>; extra: string; workflow: string };
const basicParameterNames = ["steps", "cfgScale", "seed", "sampler", "sampleMethod", "scheduler", "schedule"];
export function basicImageParameterKeys(context: ImageParameterContext) {
  const suggestions = imageParameterSuggestions(context);
  return basicParameterNames.filter(key => suggestions[key]);
}

export function imageParameterDraft(parameters: ImageParameters = {}, context: ImageParameterContext): ImageParameterDraft {
  const profile = imageParameterProfile(context);
  const scoped = profile === "moss" || profile === "sd" ? splitCivitaiParameters(parameters) : { input: parameters, workflow: {}, query: {} };
  const editable = basicImageParameterKeys(context).filter(key => typeof scoped.input[key] === "number" || typeof scoped.input[key] === "string");
  const topLevel = Object.fromEntries([
    ...Object.entries(scoped.workflow).map(([key, value]) => [/^(?:query|workflow)\./.test(key) ? `workflow.${key}` : key, value]),
    ...Object.entries(scoped.query).map(([key, value]) => [`query.${key}`, value]),
  ]);
  return {
    values: Object.fromEntries(editable.map(key => [key, String(scoped.input[key])])),
    extra: formatImageParameterText(Object.fromEntries(Object.entries(scoped.input).filter(([key]) => !editable.includes(key)))),
    workflow: formatImageParameterText(topLevel),
  };
}

export function readImageParameterDraft(draft: ImageParameterDraft, context: ImageParameterContext) {
  const parameters = parseImageParameterText(draft.extra, context);
  const suggestions = imageParameterSuggestions(context);
  for (const [key, value] of Object.entries(draft.values)) {
    if (!value.trim()) continue;
    if (Object.hasOwn(parameters, key)) throw new Error(`图片参数「${key}」已在上方设置，请从额外参数中移除重复项`);
    parameters[key] = suggestions[key]?.type === "number" ? Number(value) : value;
  }
  const profile = imageParameterProfile(context);
  if (profile !== "moss" && profile !== "sd") return validateImageParameters(parameters, context);
  const result: ImageParameters = Object.fromEntries(Object.entries(parameters).map(([key, value]) => [`input.${key}`, value]));
  for (const [key, value] of Object.entries(parseImageParameterText(draft.workflow, context))) {
    const name = /^(?:workflow|query)\./.test(key) ? key : `workflow.${key}`;
    if (Object.hasOwn(result, name)) throw new Error(`工作流参数「${key}」重复，请只填写一次`);
    result[name] = value;
  }
  splitCivitaiParameters(result);
  return validateImageParameters(result, context);
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
