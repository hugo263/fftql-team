-- Fail closed until an administrator explicitly starts X collection.
INSERT INTO settings(key,value)
VALUES ('collection.x','{"enabled":false,"initialized":false}'::jsonb)
ON CONFLICT (key) DO NOTHING;
