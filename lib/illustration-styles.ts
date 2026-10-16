export const ILLUSTRATION_STYLES = [
  { value: "auto", label: "跟随 Prompt", description: "不额外指定风格，按图片提示词呈现。", instruction: "" },
  { value: "literary", label: "文学插图", description: "细腻叙事，柔和光影，突出人物情绪。", instruction: "细腻的文学插图，柔和而有层次的光影，克制的色彩，注重人物情绪和叙事氛围。" },
  { value: "watercolor", label: "水彩插画", description: "通透色彩，水彩晕染与纸张纹理。", instruction: "水彩插画，通透的色彩与自然晕染，保留纸张纹理和手绘笔触，画面轻盈柔和。" },
  { value: "ink", label: "国风水墨", description: "水墨浓淡，宣纸质感，疏密留白。", instruction: "国风水墨插图，以墨色浓淡和写意笔触塑造人物与环境，宣纸质感，适度留白，可辅以淡彩。" },
  { value: "anime", label: "日系动漫", description: "清晰线稿，赛璐璐上色，生动表情。", instruction: "日系动漫插图，清晰流畅的线稿，精致的赛璐璐上色，生动的人物表情与细致的背景。" },
  { value: "cinematic", label: "电影写实", description: "真实材质，电影光影，镜头叙事。", instruction: "电影感写实画面，真实的人物比例和材质，讲究镜头构图、景深与戏剧性光影。" },
  { value: "oil", label: "油画质感", description: "丰富色层，可见笔触，厚重质感。", instruction: "油画风格插图，丰富的色彩层次，可见的画布纹理与厚涂笔触，具有绘画感的光影。" },
  { value: "pencil", label: "铅笔素描", description: "黑白灰调，铅笔排线，纸面质感。", instruction: "铅笔素描插图，以黑白灰和细腻排线表现体积与光影，保留铅笔笔触和纸面质感。" },
  { value: "flat", label: "扁平插画", description: "简洁形状，干净色块，鲜明构图。", instruction: "扁平插画，简洁的几何形状和干净的色块，精炼轮廓，弱化立体阴影，构图清晰鲜明。" },
  { value: "papercut", label: "剪纸拼贴", description: "层叠纸张，手工边缘，柔和投影。", instruction: "剪纸拼贴风格的单幅插图，以层叠彩纸构成完整场景，保留手工裁切边缘、纸张纤维和柔和投影。" },
  { value: "3d", label: "3D 绘本", description: "圆润造型，立体材质，温暖灯光。", instruction: "3D 绘本插图，圆润精致的造型，细腻的立体材质，柔和温暖的灯光，富有故事感。" },
  { value: "pixel", label: "像素艺术", description: "清晰像素，有限色板，复古质感。", instruction: "像素艺术插图，以清晰可见的像素块和有限色板表现完整场景，像素边缘利落，保留人物动作与叙事细节。" },
] as const;

export type IllustrationStylePreset = typeof ILLUSTRATION_STYLES[number]["value"];
export const DEFAULT_ILLUSTRATION_STYLE: IllustrationStylePreset = "literary";

export function isIllustrationStylePreset(value: unknown): value is IllustrationStylePreset {
  return typeof value === "string" && ILLUSTRATION_STYLES.some(style => style.value === value);
}

export function illustrationVisualDirection(preset: string | undefined, requirements = "") {
  const style = ILLUSTRATION_STYLES.find(style => style.value === preset);
  return [style?.instruction ? `插图风格：${style.label}。${style.instruction}` : "", requirements.trim()].filter(Boolean).join("\n");
}
