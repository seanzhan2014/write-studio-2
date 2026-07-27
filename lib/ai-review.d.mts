export type ReviewOutlineSource = { id: string; title: string; plan: string; name: string; text: string };
export type ReviewBlock = { id: string; outlineId: string; start: number; end: number; text: string };
export type ReviewEdit = { outlineId: string; fromBlockId: string; toBlockId: string; replacement: string; ruleIds: string[] };
export type ReviewResponse = { version: 1; chapterId: string; sourceDigest: string; edits: ReviewEdit[] };

export class AiReviewResultError extends Error {}
export function createReviewBlocks(outlineId: string, outlineIndex: number, text: string): ReviewBlock[];
export function reviewSourceDigestInput(chapterId: string, outlines: ReviewOutlineSource[]): string;
export function reviewSourceDigest(chapterId: string, outlines: ReviewOutlineSource[]): Promise<string>;
export function parseReviewResponse(value: unknown): ReviewResponse;
export function applyReviewEdits(outlines: ReviewOutlineSource[], edits: ReviewEdit[]): Map<string, string>;
