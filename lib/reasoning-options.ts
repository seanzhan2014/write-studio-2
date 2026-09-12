export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];

// undefined inherits the model; null explicitly omits the request parameter.
export type ReasoningOptions = { reasoningEffort?: ReasoningEffort | null };

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return REASONING_EFFORTS.includes(value as ReasoningEffort);
}

export function normalizeReasoningEffort(value: unknown): ReasoningEffort | null {
  return isReasoningEffort(value) ? value : null;
}

export function reasoningEffortError(value: unknown): string | undefined {
  if (value !== undefined && value !== null && !isReasoningEffort(value)) {
    return `reasoning_effort 必须为 ${REASONING_EFFORTS.join("、")}，或不设定`;
  }
}

export function resolveReasoningEffort(model: ReasoningOptions | null | undefined, override?: ReasoningEffort | null): ReasoningEffort | null {
  return normalizeReasoningEffort(override === undefined ? model?.reasoningEffort : override);
}

export function reasoningRequestBody(model: ReasoningOptions, override?: ReasoningEffort | null) {
  const effort = resolveReasoningEffort(model, override);
  return effort === null ? {} : { reasoning_effort: effort };
}

export function taskReasoningEffort(options?: ReasoningOptions & { resolvedReasoningEffort?: ReasoningEffort | null }) {
  return options?.resolvedReasoningEffort !== undefined ? options.resolvedReasoningEffort : options?.reasoningEffort;
}
