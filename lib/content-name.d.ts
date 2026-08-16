export type NamedOutlineContent = {
  contentName?: string;
  currentVersionId?: string | null;
  defaultVersionId?: string | null;
  contentOverride?: boolean;
  sourceVersionId?: string;
  updatedAt: string;
  versions: Array<{ id: string; name: string }>;
};

export function timestampContentName(value?: string | number | Date): string;
export function localTimestampContentName(value?: string | number | Date): string;
export function aiGenerateContentName(modelId?: string, value?: string | number | Date): string;
export function resolvedOutlineContentName(outline: NamedOutlineContent): string;
export function aiReviewContentName(outline: NamedOutlineContent): string;
