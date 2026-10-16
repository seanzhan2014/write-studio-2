import { getDatabase } from "./sqlite";
import { currentTaskExecutionOrigin } from "./task-execution";

export function illustrationTaskRevision(now: string) {
  return getDatabase().prepare("UPDATE app_settings SET value_json=CAST(CAST(value_json AS INTEGER)+1 AS TEXT),updated_at=? WHERE key IN ('state_revision','database_version')").bind(now);
}

// The library owns saved artifacts; ai_tasks owns their place in the shared
// queue. Registration is atomic and recorded on the library entry, so removing
// an AI task never resurrects it or deletes its saved prompt/image.
export function illustrationTaskRegistration(id: string) {
  const db = getDatabase();
  return [
    db.prepare(`INSERT OR IGNORE INTO ai_tasks(id,article_id,chapter_id,outline_id,target,instruction,model_id,execution_origin,context_options_json,idempotency_key,status,attempt,result_text,error_message,phase,started_at,completed_at,last_progress_at,runner_id,lease_until,timeout_ms,created_at)
      SELECT h.id,o.article_id,o.chapter_id,h.outline_id,CASE h.kind WHEN 'prompt' THEN 'illustration-prompt' ELSE 'illustration-image' END,
        CASE h.kind WHEN 'prompt' THEN COALESCE(NULLIF(h.style,''),'从正文选景并编写插图 prompt') ELSE h.prompt END,h.model_id,?,
        json_object('illustrationId',h.id,'illustrationKind',h.kind,'illustrationInput',json(h.input_json),
          'includePrevious',json('false'),'includeCharacters',json(CASE h.kind WHEN 'prompt' THEN 'true' ELSE 'false' END),
          'estimatedCharacters',length(COALESCE(json_extract(h.input_json,'$.content'),h.prompt)),
          'configuredModelId',h.model_id,'modelName',h.model_name),
        h.id,h.status,CASE h.status WHEN 'queued' THEN 0 ELSE 1 END,CASE h.status WHEN 'success' THEN h.prompt END,h.error_message,
        CASE h.status WHEN 'queued' THEN 'queued' WHEN 'running' THEN 'generating' WHEN 'success' THEN 'completed' WHEN 'error' THEN 'failed' ELSE 'cancelled' END,
        CASE WHEN h.status<>'queued' THEN h.created_at END,h.completed_at,COALESCE(h.completed_at,h.created_at),h.runner_id,h.lease_until,
        COALESCE(m.timeout_override_ms,p.timeout_ms,m.timeout_ms,120000),h.created_at
      FROM illustration_history h JOIN outlines o ON o.id=h.outline_id LEFT JOIN ai_models m ON m.id=h.model_id LEFT JOIN ai_providers p ON p.id=m.provider_id
      WHERE h.id=? AND h.model_id<>'' AND COALESCE(json_extract(h.input_json,'$._aiTaskRegistered'),0)=0`)
      .bind(currentTaskExecutionOrigin(), id),
    db.prepare("UPDATE illustration_history SET input_json=json_set(input_json,'$._aiTaskRegistered',json('true')) WHERE id=? AND model_id<>''").bind(id),
  ];
}

export async function registerIllustrationTasks() {
  const rows = await getDatabase().prepare("SELECT id FROM illustration_history WHERE model_id<>'' AND COALESCE(json_extract(input_json,'$._aiTaskRegistered'),0)=0 ORDER BY created_at DESC LIMIT 20").all<{ id: string }>();
  // An in-flight request from the previous deployment can still complete in
  // the library after registration. Reflect that completion in its AI task.
  const changed = await getDatabase().prepare("SELECT h.id FROM illustration_history h JOIN ai_tasks t ON t.id=h.id WHERE t.target IN ('illustration-prompt','illustration-image') AND t.execution_origin=? AND t.status<>h.status LIMIT 20")
    .bind(currentTaskExecutionOrigin()).all<{ id: string }>();
  if (!rows.results?.length && !changed.results?.length) return;
  const now = new Date().toISOString();
  await getDatabase().batch([...(rows.results ?? []).flatMap(row => illustrationTaskRegistration(row.id)), ...(changed.results ?? []).map(row => syncIllustrationTask(row.id, now)), illustrationTaskRevision(now)]);
}

export function syncIllustrationTask(id: string, now: string) {
  return getDatabase().prepare(`UPDATE ai_tasks SET
    attempt=CASE WHEN status<>'running' AND (SELECT status FROM illustration_history WHERE id=?)='running' THEN attempt+1 ELSE attempt END,
    started_at=CASE WHEN (SELECT status FROM illustration_history WHERE id=?)='running' THEN COALESCE(started_at,?) ELSE started_at END,
    status=(SELECT status FROM illustration_history WHERE id=?),
    phase=(SELECT CASE status WHEN 'queued' THEN 'queued' WHEN 'running' THEN 'generating' WHEN 'success' THEN 'completed' WHEN 'error' THEN 'failed' ELSE 'cancelled' END FROM illustration_history WHERE id=?),
    result_text=(SELECT CASE WHEN status='success' THEN prompt END FROM illustration_history WHERE id=?),
    received_characters=(SELECT CASE WHEN status='success' THEN length(prompt) ELSE 0 END FROM illustration_history WHERE id=?),
    error_message=(SELECT error_message FROM illustration_history WHERE id=?),
    completed_at=(SELECT completed_at FROM illustration_history WHERE id=?),
    runner_id=(SELECT runner_id FROM illustration_history WHERE id=?),lease_until=(SELECT lease_until FROM illustration_history WHERE id=?),last_progress_at=?
    WHERE id=? AND target IN ('illustration-prompt','illustration-image') AND EXISTS(SELECT 1 FROM illustration_history WHERE id=?)`)
    .bind(id, id, now, id, id, id, id, id, id, id, id, now, id, id);
}
