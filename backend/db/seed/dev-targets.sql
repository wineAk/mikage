-- ローカル開発用のダミー target。本番 Compose 起動では自動適用しない。
INSERT INTO mikage.targets (key, name, url, headers, is_enabled) VALUES
  ('dev-alpha', 'Dev Alpha', 'https://example.invalid/alpha', NULL, true),
  ('dev-beta', 'Dev Beta', 'https://example.invalid/beta', '{"X-Dev": "1"}'::jsonb, true),
  ('dev-disabled', 'Dev Disabled', 'https://example.invalid/off', NULL, false)
ON CONFLICT (key) DO NOTHING;