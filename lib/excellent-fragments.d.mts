export type ExcellentFragment = {
  id: string;
  start: number;
  end: number;
  text: string;
  prefix: string;
  suffix: string;
  sourceHash: string;
  createdAt: string;
  updatedAt: string;
};

export function contentFingerprint(value: unknown): string;
export function normalizeExcellentFragments(content: string, fragments: unknown): ExcellentFragment[];
export function cloneExcellentFragments(content: string, fragments: ExcellentFragment[]): ExcellentFragment[];
export function toggleExcellentFragment(
  content: string,
  fragments: ExcellentFragment[],
  selection: { start: number; end: number },
  create: { id: string; createdAt: string; updatedAt?: string },
): { action: "added" | "removed" | "none"; fragments: ExcellentFragment[] };
export function reanchorExcellentFragments(previousContent: string, nextContent: string, fragments: ExcellentFragment[]): ExcellentFragment[];
export function paragraphRangeAt(content: string, offset: number): { start: number; end: number } | null;
