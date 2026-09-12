ALTER TABLE `ai_tasks` ADD `history_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS ai_tasks_history_insert AFTER INSERT ON ai_tasks
  WHEN NOT (json_extract(NEW.history_json,'$[#-1].phase') IS COALESCE(NEW.phase,CASE NEW.status WHEN 'queued' THEN 'queued' WHEN 'success' THEN 'completed' WHEN 'error' THEN 'failed' WHEN 'cancelled' THEN 'cancelled' ELSE 'generating' END)
  AND json_extract(NEW.history_json,'$[#-1].attempt') IS NEW.attempt
  AND json_extract(NEW.history_json,'$[#-1].reviewRound') IS json_extract(NEW.context_options_json,'$.reviewRound')
  AND json_extract(NEW.history_json,'$[#-1].executionOrigin') IS NEW.execution_origin)
  BEGIN
    UPDATE ai_tasks SET history_json=json_insert(NEW.history_json,'$[#]',json_object(
  'at',COALESCE(NEW.completed_at,NEW.last_progress_at,NEW.started_at,NEW.created_at),'phase',COALESCE(NEW.phase,CASE NEW.status WHEN 'queued' THEN 'queued' WHEN 'success' THEN 'completed' WHEN 'error' THEN 'failed' WHEN 'cancelled' THEN 'cancelled' ELSE 'generating' END),'attempt',NEW.attempt,
  'reviewRound',json_extract(NEW.context_options_json,'$.reviewRound'),
  'executionOrigin',NEW.execution_origin,'error',NEW.error_message)) WHERE id=NEW.id;
  END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS ai_tasks_history_update AFTER UPDATE OF phase,status,attempt,execution_origin,context_options_json ON ai_tasks
  WHEN (NEW.phase IS NOT OLD.phase OR NEW.status IS NOT OLD.status OR NEW.attempt IS NOT OLD.attempt
    OR NEW.execution_origin IS NOT OLD.execution_origin
    OR json_extract(NEW.context_options_json,'$.reviewRound') IS NOT json_extract(OLD.context_options_json,'$.reviewRound'))
    AND NOT (json_extract(NEW.history_json,'$[#-1].phase') IS COALESCE(NEW.phase,CASE NEW.status WHEN 'queued' THEN 'queued' WHEN 'success' THEN 'completed' WHEN 'error' THEN 'failed' WHEN 'cancelled' THEN 'cancelled' ELSE 'generating' END)
  AND json_extract(NEW.history_json,'$[#-1].attempt') IS NEW.attempt
  AND json_extract(NEW.history_json,'$[#-1].reviewRound') IS json_extract(NEW.context_options_json,'$.reviewRound')
  AND json_extract(NEW.history_json,'$[#-1].executionOrigin') IS NEW.execution_origin)
  BEGIN
    UPDATE ai_tasks SET history_json=json_insert(
      CASE WHEN json_array_length(NEW.history_json)=0 THEN json_array(json_object(
  'at',COALESCE(OLD.completed_at,OLD.last_progress_at,OLD.started_at,OLD.created_at),'phase',COALESCE(OLD.phase,CASE OLD.status WHEN 'queued' THEN 'queued' WHEN 'success' THEN 'completed' WHEN 'error' THEN 'failed' WHEN 'cancelled' THEN 'cancelled' ELSE 'generating' END),'attempt',OLD.attempt,
  'reviewRound',json_extract(OLD.context_options_json,'$.reviewRound'),
  'executionOrigin',OLD.execution_origin,'error',OLD.error_message)) ELSE NEW.history_json END,
      '$[#]',json_object(
  'at',COALESCE(CASE WHEN NEW.last_progress_at IS NOT OLD.last_progress_at THEN NEW.last_progress_at END,strftime('%Y-%m-%dT%H:%M:%fZ','now')),'phase',COALESCE(NEW.phase,CASE NEW.status WHEN 'queued' THEN 'queued' WHEN 'success' THEN 'completed' WHEN 'error' THEN 'failed' WHEN 'cancelled' THEN 'cancelled' ELSE 'generating' END),'attempt',NEW.attempt,
  'reviewRound',json_extract(NEW.context_options_json,'$.reviewRound'),
  'executionOrigin',NEW.execution_origin,'error',NEW.error_message)) WHERE id=NEW.id;
  END;
