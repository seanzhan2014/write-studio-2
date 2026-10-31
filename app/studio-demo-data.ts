import { now, emptyChat, outline } from "@/lib/studio-entities";
import { DEFAULT_STUDIO_SETTINGS } from "@/lib/studio-settings";
import type { StudioData } from "@/lib/studio-types";

import { DEFAULT_AI_GENERATE_OPTIONS } from "@/lib/generate-options";

import { DEFAULT_CHAPTER_NAMING_PROFILE, DEFAULT_OUTLINE_NAMING_PROFILE } from "@/lib/naming-options";

import { EMPTY_ARTICLE_STORY_SETTINGS } from "@/lib/story-settings";

export const openingContent = "雨从凌晨开始落，到清晨也没有停下来的意思。\n\n林澈推开修理铺的百叶门时，海风正沿着旧街一路灌进来，带着盐、铁锈和昨夜没有散尽的雾。门后的铜铃只响了半声，像被谁在梦里按住。\n\n工作台上多了一封信。\n\n信封是最普通的牛皮纸，边缘却被海水泡得发白。她翻到背面，没有邮票，也没有寄件人的名字，只有一行熟悉得让她停住呼吸的字：给二〇三三年的林澈。\n\n那是她自己的笔迹。\n\n她没有立刻拆开。墙上的挂钟走到八点十七分，老旧的秒针轻轻颤了一下。远处，港口的雾笛在看不见的海面上响起，低沉得像某种迟到了很多年的回答。";

export const opening = outline(
  "outline-1",
  "收到一封来自未来的信",
  "林澈在修复旧收音机时，发现一封落款日期是七年后的信。信里只有一张潮汐表和一句警告。建立悬念，同时交代她与这座海港的疏离关系。",
  openingContent,
);

opening.versions = [
  { id: "version-ai-opening", name: "AI：加强开场悬念", source: "AI Generate", createdAt: "2026-07-28T14:28:00.000Z", content: "雨从凌晨开始落，挂钟的秒针却忽然向后退了一格。\n\n工作台上多了一封信，像有人刚刚离开。信封正面写着：给二〇三三年的林澈。" },
  { id: "version-manual-opening", name: "手动版本", source: "手动", createdAt: "2026-07-28T13:46:00.000Z", content: openingContent },
  { id: "version-draft-opening", name: "初稿", source: "手动", createdAt: "2026-07-27T22:10:00.000Z", content: "工作台上放着一封信。信封边缘被海水泡得发白，收件人却是七年后的林澈。" },
];

opening.chat = emptyChat(opening.id, [
  { id: "message-1", role: "user", text: "这段开场的悬念够强吗？我希望读者第一段就意识到时间出了问题。", createdAt: "2026-07-28T14:10:00.000Z" },
  { id: "message-2", role: "assistant", text: "悬念已经成立。可以让墙上的钟先倒走一秒，再出现那封信，让时间异常先被感知、再被文字确认。", createdAt: "2026-07-28T14:10:08.000Z" },
]);

export const seedData: StudioData = {
  version: 1,
  currentArticleId: "harbor-letters",
  currentOutlineId: "outline-1",
  articles: [
    {
      id: "harbor-letters",
      title: "潮汐来信",
      summary: "一部发生在 2033 年前后的近未来悬疑小说。林澈收到一封来自七年后的信，为了弄清寄信人，她回到停用的旧码头，也重新遇见了那个本应消失的人。时间异常只通过信件和潮汐发生，改变过去必然造成等价记忆缺失。",
      type: "",
      style: "克制、写实，重视环境细节",
      storySettings: {
        location: "常年多雾的临海旧港与已经停用的第七码头",
        negativeConstraints: "不出现无代价复活。\n不把时间异常解释成梦境。",
      },
      chapterNaming: DEFAULT_CHAPTER_NAMING_PROFILE,
      outlineNaming: DEFAULT_OUTLINE_NAMING_PROFILE,
      aiGenerateSettings: DEFAULT_AI_GENERATE_OPTIONS,
      createdAt: "2026-07-12T09:00:00.000Z",
      updatedAt: now,
      lastOutlineId: "outline-1",
      chapters: [
        {
          id: "chapter-1",
          title: "第一章 · 潮汐之前",
          archived: false,
          outlines: [
            opening,
            outline("outline-2", "旧码头的重逢", "林澈按照信中线索前往已经停用的七码头，意外遇见多年未见的顾屿。他似乎也在寻找同一件东西。", "七码头的铁门已经锈死，顾屿却站在门的另一边，像从未离开过这座城。\n\n“你迟到了七年。”他说。", "running"),
            outline("outline-3", "潮汐表上的空白", "发现日期缺失与七年前的事故有关，推动林澈主动追查。", "潮汐表八月十七日的位置是一片空白，像有人从时间里整齐地剪走了一天。"),
          ],
        },
        {
          id: "chapter-2",
          title: "第二章 · 雾中航线",
          archived: false,
          outlines: [
            outline("outline-4", "凌晨三点的灯塔", "让两位主角在灯塔内发现第二条线索，关系因共同的秘密发生变化。", "灯塔的光每隔十二秒扫过窗面，也把两个人的影子一次次推回黑暗里。"),
            outline("outline-5", "失踪的第七码头", "旧海图显示港区曾经存在第七码头，但所有现实记录都否认它。", "海图摊开时，一条不存在的航线正在墨迹里缓慢显现。", "failed"),
          ],
        },
        {
          id: "chapter-3",
          title: "第三章 · 回声抵岸",
          archived: false,
          outlines: [outline("outline-6", "黎明前的选择", "林澈需要在保留现有时间线和救回失踪者之间作出选择。", "天亮以前，她只能寄出一封信。")],
        },
      ],
      characters: [
        { id: "character-lin", name: "林澈", aliases: ["阿澈"], description: "海港长大的精密仪器修理师，冷静、敏锐、谨慎，擅长维修精密仪器和辨识旧地图。她习惯说短句，先确认事实再表达判断；目前对故乡和七年前的事故保持疏离与戒备，只知道事故的公开结论，不知道顾屿失踪与潮汐信件有关。", profile: { age: "29 岁", appearance: "短发，常穿深色工作服，指尖有细小划痕", immutableTraits: "面对失序会害怕，但一定会追查到可以验证的事实" }, archived: false },
        { id: "character-gu", name: "顾屿", aliases: ["顾先生"], description: "七年前失踪的海图绘制员，克制且擅长隐藏真实意图，拥有出色的航线记忆。他很少解释，常用含有双重意思的陈述代替回答；目前急于阻止某件事发生，又不愿让林澈承担代价。他知道信件来源和七年前事故的真相，但不知道本次循环会在哪一刻结束。", profile: { age: "31 岁", appearance: "左手有旧伤，衣着整洁", immutableTraits: "即使隐瞒动机，也不会把林澈当成可以牺牲的工具" }, archived: false },
        { id: "character-zhou", name: "周岚", aliases: ["周姨"], description: "熟悉港务档案和潮汐记录的港务记录员，谨慎而固执，说话缓慢并习惯给出具体日期。她保存着旧港关闭前最后一份完整潮汐记录，希望秘密终止在自己这里；她知道旧港记录被改写过，但不知道顾屿仍然活着。", profile: { age: "58 岁", appearance: "总带着一本蓝封皮记录册", immutableTraits: "宁可保持沉默，也不会编造证据" }, archived: false },
      ],
      relationships: [
        { id: "relation-1", characterAId: "character-lin", characterBId: "character-gu", description: "旧日搭档 / 彼此隐瞒关键信息" },
        { id: "relation-2", characterAId: "character-lin", characterBId: "character-zhou", description: "忘年之交 / 记录委托" },
        { id: "relation-3", characterAId: "character-gu", characterBId: "character-zhou", description: "共同保守七年前的秘密" },
      ],
    },
    {
      id: "south-city",
      title: "城南旧事集",
      summary: "关于旧城街巷与家庭记忆的短篇集。",
      type: "",
      style: "温柔、含蓄",
      storySettings: { ...EMPTY_ARTICLE_STORY_SETTINGS },
      chapterNaming: DEFAULT_CHAPTER_NAMING_PROFILE,
      outlineNaming: DEFAULT_OUTLINE_NAMING_PROFILE,
      aiGenerateSettings: DEFAULT_AI_GENERATE_OPTIONS,
      createdAt: "2026-06-02T09:00:00.000Z",
      updatedAt: "2026-07-20T12:00:00.000Z",
      lastOutlineId: "south-outline-1",
      chapters: [{ id: "south-chapter-1", title: "第一章 · 榕树下", archived: false, outlines: [outline("south-outline-1", "搬家前的最后一个下午", "一家人在旧屋整理多年留下的物件。", "阳光从榕树叶间落进院子，纸箱里全是没有来得及告别的年月。")]}],
      characters: [],
      relationships: [],
    },
    {
      id: "long-summer",
      title: "漫长夏日备忘录",
      summary: "一段发生在海边小镇的成长故事。",
      type: "",
      style: "明亮、松弛",
      storySettings: { ...EMPTY_ARTICLE_STORY_SETTINGS },
      chapterNaming: DEFAULT_CHAPTER_NAMING_PROFILE,
      outlineNaming: DEFAULT_OUTLINE_NAMING_PROFILE,
      aiGenerateSettings: DEFAULT_AI_GENERATE_OPTIONS,
      createdAt: "2026-05-18T09:00:00.000Z",
      updatedAt: "2026-07-18T12:00:00.000Z",
      lastOutlineId: "summer-outline-1",
      chapters: [{ id: "summer-chapter-1", title: "第一章 · 六月", archived: false, outlines: [outline("summer-outline-1", "蝉鸣开始的那天", "主角在暑假第一天收到一台旧相机。", "蝉鸣从铁路另一边传来时，邮差把那只没有寄件人的纸箱放在门口。")]}],
      characters: [],
      relationships: [],
    },
  ],
  tasks: [
    { id: "task-demo", articleId: "harbor-letters", chapterId: "chapter-1", outlineId: "outline-2", target: "正文", prompt: "延续悬疑氛围，让林澈和顾屿在旧码头重逢", model: "创作主模型", executionOrigin: "local", state: "cancelled", createdAt: "2026-07-28T14:31:00.000Z", error: "演示任务，不会自动执行" },
    { id: "task-failed", articleId: "harbor-letters", chapterId: "chapter-2", outlineId: "outline-5", target: "正文", prompt: "让海图显示出不存在的航线", model: "创作主模型", executionOrigin: "local", state: "failed", createdAt: "2026-07-28T13:50:00.000Z", error: "模拟服务暂时不可用" },
  ],
  settings: DEFAULT_STUDIO_SETTINGS,
};
