import type { AiTask, StudioData, Version } from "@/app/studio-state";
import { AiInputError, findModel, generateText } from "@/db/ai";
import { readStudioState, writeStudioState } from "@/db/runtime";
import { normalizeOutlineTitle } from "@/lib/outline-title";
import { timestampContentName } from "@/lib/content-name.mjs";

type RouteContext = { params: Promise<{ taskId: string }> };
type Mutation<T> = { changed: boolean; value: T };

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function findTask(data: StudioData, taskId: string) {
  return data.tasks.find((task) => task.id === taskId);
}

function findOutline(data: StudioData, outlineId: string) {
  for (const article of data.articles) for (const chapter of article.chapters) {
    const outline = chapter.outlines.find((item) => item.id === outlineId);
    if (outline) return { article, chapter, outline };
  }
  return null;
}

async function mutateState<T>(mutate: (data: StudioData) => Mutation<T>): Promise<T> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await readStudioState();
    if (!current.data) throw new Error("任务数据库为空");
    const next = structuredClone(current.data);
    const outcome = mutate(next);
    if (!outcome.changed) return outcome.value;
    const saved = await writeStudioState(next, current.revision);
    if (!saved.conflict) return outcome.value;
  }
  throw new Error("任务状态更新冲突，请稍后重试");
}

function taskTarget(task: AiTask) {
  return task.target === "正文" ? "content" as const : task.target === "大纲" ? "outline" as const : "chapter-title" as const;
}

function leaseTime() {
  return new Date(Date.now() + 20_000).toISOString();
}

export async function POST(_request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const runnerId = `server-${crypto.randomUUID()}`;
  try {
    const initialState = await readStudioState();
    const initialTask = initialState.data && findTask(initialState.data, taskId);
    if (!initialTask) return json({ error: "任务不存在" }, 404);
    if (initialTask.target === "AI Chat") return json({ error: "AI Chat 由流式会话执行" }, 400);
    const model = await findModel(initialTask.model);
    const timeoutMs = model?.timeoutMs ?? initialTask.timeoutMs ?? 600_000;
    const claimed = await mutateState((data) => {
      const task = findTask(data, taskId);
      if (!task) return { changed: false, value: false };
      const leaseExpired = task.state === "running" && (!task.leaseUntil || new Date(task.leaseUntil).getTime() <= Date.now());
      if (task.state !== "waiting" && !leaseExpired) return { changed: false, value: false };
      if (leaseExpired && (task.attempt ?? 0) >= 3) {
        const completedAt = new Date().toISOString();
        Object.assign(task, { state: "failed", phase: "failed", completedAt, lastProgressAt: completedAt, error: "任务执行中断，重试次数已用尽", runnerId: undefined, leaseUntil: undefined } satisfies Partial<AiTask>);
        return { changed: true, value: false };
      }
      const startedAt = new Date().toISOString();
      Object.assign(task, {
        state: "running", phase: "preparing", attempt: Math.max(1, (task.attempt ?? 0) + 1), startedAt,
        completedAt: undefined, lastProgressAt: startedAt, receivedCharacters: 0, timeoutMs,
        runnerId, leaseUntil: leaseTime(), error: undefined,
      } satisfies Partial<AiTask>);
      const found = findOutline(data, task.outlineId);
      if (found) found.outline.state = "running";
      return { changed: true, value: true };
    });
    if (!claimed) return json({ accepted: false, reason: "already_claimed" }, 202);

    const upstreamController = new AbortController();
    let heartbeatBusy = false;
    const heartbeat = setInterval(() => {
      if (heartbeatBusy || upstreamController.signal.aborted) return;
      heartbeatBusy = true;
      void mutateState((data) => {
        const task = findTask(data, taskId);
        if (!task || task.state !== "running" || task.runnerId !== runnerId) {
          upstreamController.abort("cancelled");
          return { changed: false, value: false };
        }
        task.lastProgressAt = new Date().toISOString();
        task.leaseUntil = leaseTime();
        return { changed: true, value: true };
      }).catch(() => undefined).finally(() => { heartbeatBusy = false; });
    }, 5_000);

    try {
      let result: Awaited<ReturnType<typeof generateText>> | null = null;
      let lastError: unknown;
      for (let requestAttempt = Math.max(1, (initialTask.attempt ?? 0) + 1); requestAttempt <= 3; requestAttempt += 1) {
        if (upstreamController.signal.aborted) break;
        if (requestAttempt > 1) {
          await mutateState((data) => {
            const task = findTask(data, taskId);
            if (!task || task.state !== "running" || task.runnerId !== runnerId) return { changed: false, value: false };
            task.phase = "retrying"; task.attempt = requestAttempt; task.lastProgressAt = new Date().toISOString(); task.leaseUntil = leaseTime();
            return { changed: true, value: true };
          });
          await new Promise((resolve) => setTimeout(resolve, requestAttempt === 2 ? 1_000 : 2_000));
        }
        await mutateState((data) => {
          const task = findTask(data, taskId);
          if (!task || task.state !== "running" || task.runnerId !== runnerId) return { changed: false, value: false };
          task.phase = "connecting"; task.attempt = requestAttempt; task.lastProgressAt = new Date().toISOString(); task.leaseUntil = leaseTime();
          return { changed: true, value: true };
        });
        try {
          await mutateState((data) => {
            const task = findTask(data, taskId);
            if (!task || task.state !== "running" || task.runnerId !== runnerId) return { changed: false, value: false };
            task.phase = "generating"; task.lastProgressAt = new Date().toISOString(); task.leaseUntil = leaseTime();
            return { changed: true, value: true };
          });
          result = await generateText({
            outlineId: initialTask.outlineId, instruction: initialTask.prompt, model: initialTask.model,
            target: taskTarget(initialTask), includePrevious: initialTask.contextOptions?.includePrevious ?? true,
            includeCharacters: initialTask.contextOptions?.includeCharacters ?? true, targetWords: initialTask.contextOptions?.targetWords,
          }, upstreamController.signal);
          break;
        } catch (error) {
          lastError = error;
          if (error instanceof AiInputError) break;
        }
      }

      if (!result) {
        if (upstreamController.signal.aborted) return json({ accepted: true, cancelled: true }, 202);
        throw lastError instanceof Error ? lastError : new Error("生成失败");
      }

      await mutateState((data) => {
        const task = findTask(data, taskId);
        if (!task || task.state !== "running" || task.runnerId !== runnerId) return { changed: false, value: false };
        task.phase = "saving";
        const found = findOutline(data, task.outlineId);
        if (task.target === "正文" && found) {
          const generatedTitle = normalizeOutlineTitle(result.outlineTitle);
          if (found.outline.titleGenerationPending && Array.from(generatedTitle).length >= 10 && Array.from(generatedTitle).length <= 20 && found.outline.plan === task.contextOptions?.outlinePlanSnapshot && found.outline.title === task.contextOptions?.outlineTitleSnapshot) {
            found.outline.title = generatedTitle;
            found.outline.titleGenerationPending = false;
          }
          const version: Version = {
            id: `version-${crypto.randomUUID()}`,
            name: timestampContentName(),
            content: result.text, source: "AI Generate", createdAt: new Date().toISOString(), model: task.model, modelId: model?.modelId ?? task.contextOptions?.modelId, prompt: task.prompt, taskId: task.id,
            outlineSnapshot: {
              title: task.contextOptions?.outlineTitleSnapshot ?? found.outline.title,
              plan: task.contextOptions?.outlinePlanSnapshot ?? found.outline.plan,
            },
          };
          found.outline.versions.unshift(version);
          found.outline.state = "saved";
          task.resultVersionId = version.id;
        } else if (found) {
          found.outline.state = "saved";
          task.contextOptions = {
            includePrevious: task.contextOptions?.includePrevious ?? true,
            includeCharacters: task.contextOptions?.includeCharacters ?? true,
            estimatedCharacters: task.contextOptions?.estimatedCharacters ?? 0,
            ...task.contextOptions,
            generatedOutlineTitle: result.outlineTitle,
          };
        }
        const completedAt = new Date().toISOString();
        Object.assign(task, {
          state: "success", phase: "completed", completedAt, lastProgressAt: completedAt,
          receivedCharacters: result.text.length, resultText: result.text, runnerId: undefined, leaseUntil: undefined, error: undefined,
        } satisfies Partial<AiTask>);
        return { changed: true, value: true };
      });
      return json({ accepted: true, completed: true });
    } catch (error) {
      await mutateState((data) => {
        const task = findTask(data, taskId);
        if (!task || task.state === "cancelled" || task.runnerId !== runnerId) return { changed: false, value: false };
        const completedAt = new Date().toISOString();
        Object.assign(task, {
          state: "failed", phase: "failed", completedAt, lastProgressAt: completedAt,
          error: error instanceof Error ? error.message : "生成失败", runnerId: undefined, leaseUntil: undefined,
        } satisfies Partial<AiTask>);
        const found = findOutline(data, task.outlineId);
        if (found) found.outline.state = "failed";
        return { changed: true, value: true };
      });
      return json({ accepted: true, completed: false, error: error instanceof Error ? error.message : "生成失败" }, 502);
    } finally {
      clearInterval(heartbeat);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "任务执行失败" }, 500);
  }
}
