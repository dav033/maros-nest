ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL DEFAULT '{"assignment":"email","status":"in_app","blocked":"in_app","comment":"in_app","mention":"in_app","permit":"in_app","digest":"email","digestHour":7}'::jsonb;

UPDATE users
SET notification_preferences = notification_preferences || '{"mention":"in_app"}'::jsonb
WHERE NOT (notification_preferences ? 'mention');
