import type { ReviewRuleSnapshot } from "./review-rules.mjs";
export const MAX_REVIEW_ROUNDS: number;
export const MAX_REVIEW_RULE_CHARACTERS: number;
export function normalizeReviewRounds(value: unknown): number;
export function normalizeReviewRules(value: unknown): string;
export type GenerateReviewIssue = { id: string; rule: string; description: string; evidence: string; suggestion: string; status: "open" | "resolved" | "uncertain"; reason: string };
export type GenerateReviewReport = { maxRounds: number; completedRounds: number; stopReason: "passed" | "limit"; rules: string; instruction: string; ruleSnapshot?: ReviewRuleSnapshot; issues: GenerateReviewIssue[]; history: Array<{ round: number; issues: GenerateReviewIssue[] }> };
export type GenerateReviewDraft = { text: string; inputTokens?: number; outputTokens?: number; outlineTitle?: string; outlineTitleError?: string; [key: string]: unknown };
export type GenerateReviewCheckpoint = { version: 1; phase: "review" | "revise" | "done"; round: number; draft: GenerateReviewDraft; issues: GenerateReviewIssue[]; history: GenerateReviewReport["history"]; drafts: string[]; inputTokens: number; outputTokens: number; report?: GenerateReviewReport };
export function parseGenerateReview(value: unknown, sourceDigest: string, previousIssues?: GenerateReviewIssue[]): GenerateReviewIssue[];
export function runGenerateReview(options: {
  maxRounds: number; rules?: string; instruction?: string; ruleSnapshot?: ReviewRuleSnapshot; checkpoint?: GenerateReviewCheckpoint; signal?: AbortSignal;
  generate: () => Promise<GenerateReviewDraft>;
  review: (text: string, issues: GenerateReviewIssue[], round: number) => Promise<{ issues: GenerateReviewIssue[]; inputTokens?: number; outputTokens?: number }>;
  revise: (text: string, issues: GenerateReviewIssue[], round: number) => Promise<{ text: string; inputTokens?: number; outputTokens?: number }>;
  save: (checkpoint: GenerateReviewCheckpoint) => Promise<void>;
}): Promise<{ draft: GenerateReviewDraft; report?: GenerateReviewReport }>;
