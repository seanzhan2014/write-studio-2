INSERT INTO `app_settings` (`key`, `value_json`, `updated_at`)
VALUES ('runtime_schema_version', '1', CURRENT_TIMESTAMP)
ON CONFLICT(`key`) DO UPDATE SET
  `value_json` = excluded.`value_json`,
  `updated_at` = excluded.`updated_at`;
