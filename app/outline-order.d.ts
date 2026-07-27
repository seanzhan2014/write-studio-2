export type OutlinePlacement = "before" | "after";

export function moveOutlineBetweenChapters<
  TOutline extends { id: string },
  TChapter extends { outlines: TOutline[] },
>(chapters: TChapter[], sourceId: string, targetId: string, placement: OutlinePlacement): TChapter[];

export function moveOutlineToChapterEnd<
  TOutline extends { id: string },
  TChapter extends { id: string; outlines: TOutline[] },
>(chapters: TChapter[], sourceId: string, targetChapterId: string): TChapter[];
