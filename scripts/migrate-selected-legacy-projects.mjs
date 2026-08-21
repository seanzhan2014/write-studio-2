import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const workspace = process.cwd();
const sourcePath = path.resolve(workspace, "..", "novellistDB", "novelist-studio.db");
const targetPath = path.resolve(workspace, "data", "writer-studio.sqlite");
const requestedTitles = new Set(["移花接木3", "keer"]);

const source = new DatabaseSync(sourcePath, { readOnly: true });
const target = new DatabaseSync(targetPath);

function all(database, sql, ...values) {
  return database.prepare(sql).all(...values);
}

function one(database, sql, ...values) {
  return database.prepare(sql).get(...values);
}

function run(database, sql, ...values) {
  return database.prepare(sql).run(...values);
}

function text(value, fallback = "") {
  return value == null ? fallback : String(value);
}

function parseJson(value, fallback) {
  try { return JSON.parse(text(value)); } catch { return fallback; }
}

function nonEmpty(value) {
  return text(value).trim();
}

function outlineTitle(plan, index) {
  const firstLine = nonEmpty(plan).split(/\r?\n/)[0].replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "");
  const compact = firstLine.replace(/\s+/g, " ").trim();
  if (!compact) return `大纲 ${index + 1}`;
  return compact.length > 80 ? `${compact.slice(0, 77)}…` : compact;
}

function dateOrFallback(value, fallback) {
  const candidate = nonEmpty(value);
  return candidate || fallback;
}

const projects = all(source, "SELECT * FROM projects WHERE title IN (?, ?) ORDER BY id", "移花接木3", "keer");
if (projects.length !== requestedTitles.size) {
  throw new Error(`Expected ${requestedTitles.size} source projects, found ${projects.length}`);
}

const existingTitles = new Set(all(target, "SELECT title FROM articles").map((row) => text(row.title)));
const duplicateTitles = projects.map((row) => text(row.title)).filter((title) => existingTitles.has(title));
if (duplicateTitles.length) throw new Error(`Target already contains article title(s): ${duplicateTitles.join(", ")}`);

const projectIds = new Set(projects.map((row) => Number(row.id)));
const chapters = all(source, "SELECT * FROM chapters WHERE projectId IN (?, ?) ORDER BY projectId, \"order\", id", 3, 4)
  .filter((row) => projectIds.has(Number(row.projectId)));
const broadOutlines = all(source, "SELECT * FROM broadOutlines WHERE chapterId IN (SELECT id FROM chapters WHERE projectId IN (?, ?)) ORDER BY chapterId, \"order\", id", 3, 4);
const detailedOutlines = all(source, "SELECT * FROM detailedOutlines WHERE broadOutlineId IN (SELECT id FROM broadOutlines WHERE chapterId IN (SELECT id FROM chapters WHERE projectId IN (?, ?))) ORDER BY broadOutlineId, \"order\", id", 3, 4);
const oldContents = all(source, "SELECT * FROM content WHERE detailedOutlineId IN (SELECT id FROM detailedOutlines WHERE broadOutlineId IN (SELECT id FROM broadOutlines WHERE chapterId IN (SELECT id FROM chapters WHERE projectId IN (?, ?))))", 3, 4);
const oldVersions = all(source, "SELECT * FROM versions WHERE parentType='detailed' AND parentId IN (SELECT id FROM detailedOutlines WHERE broadOutlineId IN (SELECT id FROM broadOutlines WHERE chapterId IN (SELECT id FROM chapters WHERE projectId IN (?, ?)))) ORDER BY parentId, timestamp, id", 3, 4);
const oldCharacters = all(source, "SELECT * FROM characters WHERE projectId IN (?, ?) ORDER BY projectId, id", 3, 4);
const oldRelationships = all(source, "SELECT * FROM relationships WHERE projectId IN (?, ?) ORDER BY projectId, id", 3, 4);

const sourceContentByDetailed = new Map(oldContents.map((row) => [Number(row.detailedOutlineId), row]));
const sourceVersionsByDetailed = new Map();
for (const row of oldVersions) {
  const key = Number(row.parentId);
  const list = sourceVersionsByDetailed.get(key) ?? [];
  list.push(row);
  sourceVersionsByDetailed.set(key, list);
}
const sourceBroadById = new Map(broadOutlines.map((row) => [Number(row.id), row]));

const now = new Date().toISOString();
const currentRevision = Number(one(target, "SELECT value_json FROM app_settings WHERE key='state_revision'")?.value_json ?? 0);
const nextRevision = currentRevision + 1;

const articleIdByProject = new Map(projects.map((row) => [Number(row.id), `legacy-project-${row.id}`]));
const chapterIdByOldId = new Map(chapters.map((row) => [Number(row.id), `legacy-chapter-${row.id}`]));
const outlineIdByOldId = new Map(detailedOutlines.map((row) => [Number(row.id), `legacy-outline-${row.id}`]));
const characterIdByOldId = new Map(oldCharacters.map((row) => [Number(row.id), `legacy-character-${row.id}`]));

const existingIds = new Set([
  ...all(target, "SELECT id FROM articles").map((row) => text(row.id)),
  ...all(target, "SELECT id FROM chapters").map((row) => text(row.id)),
  ...all(target, "SELECT id FROM outlines").map((row) => text(row.id)),
]);
for (const id of [...articleIdByProject.values(), ...chapterIdByOldId.values(), ...outlineIdByOldId.values()]) {
  if (existingIds.has(id)) throw new Error(`Target already contains migration id: ${id}`);
}

target.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
try {
  for (const project of projects) {
    const projectId = Number(project.id);
    const articleId = articleIdByProject.get(projectId);
    const createdAt = dateOrFallback(project.createdAt, now);
    const updatedAt = dateOrFallback(project.updatedAt, createdAt);
    const style = text(project.styleDescription);
    target.prepare("INSERT INTO articles(id,title,summary,article_type,style,chapter_naming_json,outline_naming_json,created_at,updated_at,last_opened_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(articleId, text(project.title).slice(0, 120), text(project.summary), text(project.articleType), style, "{}", "{}", createdAt, updatedAt, updatedAt, nextRevision);

    const projectChapters = chapters.filter((row) => Number(row.projectId) === projectId)
      .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0) || Number(left.id) - Number(right.id));
    projectChapters.forEach((chapter, chapterIndex) => {
      const chapterId = chapterIdByOldId.get(Number(chapter.id));
      const chapterCreatedAt = createdAt;
      const chapterUpdatedAt = updatedAt;
      target.prepare("INSERT INTO chapters(id,article_id,title,position,archived,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?)")
        .run(chapterId, articleId, text(chapter.title) || `第${chapterIndex + 1}章`, (chapterIndex + 1) * 1024, Number(chapter.archived) === 1 ? 1 : 0, chapterCreatedAt, chapterUpdatedAt, nextRevision);
      target.prepare("INSERT INTO search_documents(article_id,chapter_id,outline_id,entity_type,entity_id,title,body) VALUES(?,?,?,?,?,?,?)")
        .run(articleId, chapterId, null, "chapter", chapterId, text(chapter.title), text(chapter.summary));

      const chapterBroad = broadOutlines.filter((row) => Number(row.chapterId) === Number(chapter.id))
        .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0) || Number(left.id) - Number(right.id));
      const chapterDetailed = chapterBroad.flatMap((broad) => detailedOutlines.filter((detail) => Number(detail.broadOutlineId) === Number(broad.id))
        .sort((left, right) => Number(left.order ?? 0) - Number(right.order ?? 0) || Number(left.id) - Number(right.id)));
      chapterDetailed.forEach((detail, outlineIndex) => {
        const detailId = Number(detail.id);
        const outlineId = outlineIdByOldId.get(detailId);
        const broad = sourceBroadById.get(Number(detail.broadOutlineId));
        const plan = text(detail.content);
        const title = outlineTitle(plan, outlineIndex);
        const outlineUpdatedAt = dateOrFallback(detail.updatedAt, updatedAt);
        const versions = (sourceVersionsByDetailed.get(detailId) ?? []).slice().sort((left, right) => text(left.timestamp).localeCompare(text(right.timestamp)) || Number(left.id) - Number(right.id));
        const mappedVersions = versions.map((version) => ({
          old: version,
          id: `legacy-version-${version.id}`,
          text: text(version.data) || text(version.content),
          createdAt: dateOrFallback(version.timestamp, outlineUpdatedAt),
        }));
        const primary = mappedVersions.filter((version) => Number(version.old.isPrimary) === 1).at(-1);
        const oldContent = sourceContentByDetailed.get(detailId);
        const currentText = nonEmpty(oldContent?.text) || primary?.text || mappedVersions.at(-1)?.text || "";
        const defaultVersionId = primary?.id ?? null;
        const currentVersionId = primary && primary.text === currentText ? primary.id : null;
        const contentOverride = currentVersionId ? 0 : 1;
        const snapshot = JSON.stringify({ title, plan });

        target.prepare("INSERT INTO outlines(id,article_id,chapter_id,title,summary,generate_instruction,position,archived,state,title_generation_pending,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(outlineId, articleId, chapterId, title, plan.slice(0, 10000), text(broad?.content).slice(0, 20000), (outlineIndex + 1) * 1024, Number(detail.archived) === 1 ? 1 : 0, "saved", 0, outlineUpdatedAt, outlineUpdatedAt, nextRevision);
        target.prepare("INSERT INTO contents(id,outline_id,text,content_name,content_override,source_version_id,current_version_id,default_version_id,outline_snapshot_json,manual_excellent,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(`content:${outlineId}`, outlineId, currentText, dateOrFallback(oldContent?.updatedAt, outlineUpdatedAt), contentOverride, null, currentVersionId, defaultVersionId, snapshot, 0, dateOrFallback(oldContent?.updatedAt, outlineUpdatedAt), nextRevision);
        target.prepare("INSERT INTO search_documents(article_id,chapter_id,outline_id,entity_type,entity_id,title,body) VALUES(?,?,?,?,?,?,?)")
          .run(articleId, chapterId, outlineId, "outline", outlineId, title, `${plan}\n${currentText}`);

        for (const version of mappedVersions) {
          const versionSnapshot = JSON.stringify({ title, plan: text(version.old.content) || plan });
          target.prepare("INSERT INTO versions(id,outline_id,name,text,source,model_id,model_name,prompt,task_id,outline_snapshot_json,manual_excellent,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
            .run(version.id, outlineId, text(version.old.name) || version.createdAt, version.text, "manual", null, null, null, null, versionSnapshot, 0, version.createdAt);
        }

        const history = parseJson(detail.chatHistory, []);
        if (Array.isArray(history) && history.length) {
          const messages = history.filter((message) => message && (message.role === "user" || message.role === "assistant") && nonEmpty(message.content));
          if (messages.length) {
            const sessionId = `legacy-chat-${detailId}`;
            const sessionTime = dateOrFallback(detail.updatedAt, outlineUpdatedAt);
            target.prepare("INSERT INTO chat_sessions(id,article_id,outline_id,draft,model_id,context_options_json,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,?)")
              .run(sessionId, articleId, outlineId, "", null, JSON.stringify({ title: "迁移的历史对话", includePrevious: true, includeCharacters: true }), sessionTime, sessionTime, nextRevision);
            messages.forEach((message, messageIndex) => {
              target.prepare("INSERT INTO chat_messages(id,session_id,role,content,status,order_index,created_at) VALUES(?,?,?,?,?,?,?)")
                .run(`legacy-message-${detailId}-${messageIndex}`, sessionId, message.role, text(message.content), "complete", messageIndex, dateOrFallback(message.createdAt, sessionTime));
            });
          }
        }
      });
    });
  }

  for (const character of oldCharacters) {
    const articleId = articleIdByProject.get(Number(character.projectId));
    const characterId = characterIdByOldId.get(Number(character.id));
    const aliases = parseJson(character.keywords, []);
    const aliasesJson = JSON.stringify(Array.isArray(aliases) ? aliases.map((item) => text(item)).filter(Boolean) : []);
    const description = [
      ["外貌", character.appearance], ["性格", character.personality], ["能力", character.ability], ["背景", character.background],
    ].filter(([, value]) => nonEmpty(value)).map(([label, value]) => `${label}：${text(value).trim()}`).join("\n");
    const createdAt = projects.find((project) => Number(project.id) === Number(character.projectId))?.createdAt || now;
    const updatedAt = projects.find((project) => Number(project.id) === Number(character.projectId))?.updatedAt || createdAt;
    target.prepare("INSERT INTO characters(id,article_id,name,aliases_json,description,archived,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(characterId, articleId, text(character.name), aliasesJson, description, Number(character.archived) === 1 ? 1 : 0, createdAt, updatedAt, nextRevision);
    target.prepare("INSERT INTO search_documents(article_id,chapter_id,outline_id,entity_type,entity_id,title,body) VALUES(?,?,?,?,?,?,?)")
      .run(articleId, null, null, "character", characterId, text(character.name), `${aliasesJson}\n${description}`);
  }

  for (const relationship of oldRelationships) {
    const articleId = articleIdByProject.get(Number(relationship.projectId));
    const characterAId = characterIdByOldId.get(Number(relationship.char1Id));
    const characterBId = characterIdByOldId.get(Number(relationship.char2Id));
    if (!articleId || !characterAId || !characterBId || characterAId === characterBId) continue;
    const [low, high] = [characterAId, characterBId].sort();
    target.prepare("INSERT INTO relationships(id,article_id,character_low_id,character_high_id,description,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?)")
      .run(`legacy-relationship-${relationship.id}`, articleId, low, high, text(relationship.description), now, now, nextRevision);
  }

  run(target, "INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES('state_revision',?,?)", String(nextRevision), now);
  run(target, "INSERT OR REPLACE INTO app_settings(key,value_json,updated_at) VALUES('state_write_guard',?,?)", "ready", now);
  target.exec("COMMIT");
} catch (error) {
  try { target.exec("ROLLBACK"); } catch { /* transaction may already be closed */ }
  throw error;
} finally {
  source.close();
  target.close();
}

console.log(JSON.stringify({
  migratedArticles: projects.map((row) => text(row.title)),
  chapters: chapters.length,
  outlines: detailedOutlines.length,
  versions: oldVersions.length,
  characters: oldCharacters.length,
  revision: nextRevision,
}, null, 2));
