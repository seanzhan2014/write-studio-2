export function fullStudioFixture() {
  const now = "2026-07-28T08:00:00.000Z";
  const chatMessages = Array.from({ length: 22 }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 ? "assistant" : "user",
    text: `${index < 2 ? "old" : "recent"}-message-${String(index).padStart(2, "0")}`,
    createdAt: `2026-07-28T08:${String(index).padStart(2, "0")}:00.000Z`,
  }));
  const makeOutline = (id, title, plan, content = "") => ({
    id, title, titleGenerationPending: false, plan, content, archived: false, state: "saved", updatedAt: now,
    versions: [], chat: { sessions: [{ id: `chat:${id}`, title: "主会话", messages: [], draft: "", includePrevious: true, includeCharacters: true, createdAt: now, updatedAt: now }], activeSessionId: `chat:${id}` },
  });
  const previous = makeOutline("outline-previous", "前序灯塔", "林澈在灯塔取得前序线索。", "灯塔正文");
  const current = makeOutline("outline-current", "当前码头", "林澈与顾屿在七码头会合。", "林澈看向顾屿，确认潮汐表上的时间。");
  current.versions = [
    { id: "version-manual", name: "手动快照", content: "不可变版本正文", source: "手动", createdAt: now, model: "捕获模型", prompt: "版本元数据回归", taskId: "task-version-meta", outlineSnapshot: { title: "生成时码头", plan: "生成时的大纲快照：林澈在七码头确认潮汐密钥。" } },
  ];
  current.chat.sessions[0].messages = chatMessages;
  current.chat.sessions.push({
    id: "chat:outline-current:alternate", title: "人物动机分支",
    messages: [{ id: "message-alternate", role: "user", text: "alternate-session-secret", createdAt: now }],
    draft: "分支草稿", includePrevious: false, includeCharacters: false, createdAt: now, updatedAt: now,
  });
  const after = makeOutline("outline-after", "绝密后续大纲", "这是当前大纲之后的内容，绝不能进入上下文。", "后续正文秘密");
  const archived = makeOutline("outline-archived", "归档秘密", "归档内容绝不能进入上下文。", "归档正文");
  archived.archived = true;
  return {
    version: 1,
    currentArticleId: "article-main",
    currentOutlineId: "outline-current",
    articles: [{
      id: "article-main", title: "严格测试文章", summary: "用于真实 D1 和 API 回归测试。", type: "悬疑", style: "克制",
      createdAt: now, updatedAt: now, lastOutlineId: "outline-current",
      chapters: [
        { id: "chapter-main", title: "第一章", archived: false, outlines: [previous, current, after, archived] },
        { id: "chapter-archived", title: "归档章节", archived: true, outlines: [makeOutline("outline-archived-chapter", "归档章节秘密", "不得进入上下文")] },
      ],
      characters: [
        { id: "character-lin", name: "林澈", aliases: ["阿澈"], description: "海港长大的冷静修理师。", archived: false },
        { id: "character-gu", name: "顾屿", aliases: ["GU"], description: "左手有旧伤，七年前失踪。", archived: false },
        { id: "character-archived", name: "归档人物", aliases: [], description: "不应进入 AI 上下文。", archived: true },
      ],
      relationships: [
        { id: "relationship-main", characterAId: "character-gu", characterBId: "character-lin", description: "旧日搭档与共同秘密" },
      ],
    }],
    tasks: [],
    settings: {
      theme: "light", editorFont: "sans", fontSize: 17, lineHeight: 1.8, contentWidth: 920,
      outlineExpanded: true, showArchived: false, openLastArticle: true, taskConcurrency: 2,
      chatModel: "", generateModel: "",
    },
  };
}
