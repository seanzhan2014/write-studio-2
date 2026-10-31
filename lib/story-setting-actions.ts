import { normalizeChapterSettings, type ChapterSettings, type CharacterProfileKey, type OverrideScope, type StoryFieldKey } from "./story-settings.ts";

/** Shared mutations; containers retain their filtering, timelines and undo UI. */
export function createScopedSettingActions(settings: ChapterSettings, commit: (next: ChapterSettings, label: string) => void, level: "chapter" | "outline", labels: { story: Record<StoryFieldKey, { label: string }>; character: Record<CharacterProfileKey, { label: string }> }) {
  const clone = () => structuredClone(normalizeChapterSettings(settings));
  const endingLabel = level === "chapter" ? "章末" : "大纲末";
  function updateCharacter(id: string, label: string, update: (item: ChapterSettings["characters"][string]) => void) {
    const next = clone();
    const item = next.characters[id] ?? { start: {}, end: {} };
    update(item);
    if (!Object.keys(item.start).length && !Object.keys(item.end).length && !item.appears) delete next.characters[id];
    else next.characters[id] = item;
    commit(next, label);
  }
  return {
    patchStory(key: StoryFieldKey, value: string, scope?: OverrideScope) {
      const next = clone();
      next.story[key] = { value, scope: scope ?? next.story[key]?.scope ?? "ongoing" };
      commit(next, labels.story[key].label);
    },
    restoreStory(key: StoryFieldKey) {
      const next = clone();
      delete next.story[key];
      commit(next, labels.story[key].label);
    },
    patchCharacter(id: string, key: CharacterProfileKey, value: string, scope?: OverrideScope) {
      updateCharacter(id, labels.character[key].label, item => { item.start[key] = { value, scope: scope ?? item.start[key]?.scope ?? "ongoing" }; });
    },
    restoreCharacter(id: string, key: CharacterProfileKey) {
      if (settings.characters[id]) updateCharacter(id, labels.character[key].label, item => { delete item.start[key]; });
    },
    patchEnding(id: string, key: CharacterProfileKey, value: string | undefined) {
      updateCharacter(id, `${labels.character[key].label}${endingLabel}变化`, item => {
        if (value === undefined || !value.trim()) delete item.end[key];
        else item.end[key] = value;
      });
    },
    patchAppearance(id: string, value: string, scope?: OverrideScope) {
      updateCharacter(id, "出场状态", item => {
        if (value === "inherit") delete item.appears;
        else item.appears = { value: value === "yes", scope: scope ?? item.appears?.scope ?? "chapter" };
      });
    },
  };
}
