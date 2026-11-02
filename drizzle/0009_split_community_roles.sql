-- Community & Roles was split into Community Settings ("community") and Roles Management ("roles").
-- Servers that had picked it (saved as "community", or the older "roles") get both, so nothing they use switches off.
UPDATE `guild_setup`
SET `categories` = json_insert(`categories`, '$[#]', 'community')
WHERE EXISTS (SELECT 1 FROM json_each(`guild_setup`.`categories`) WHERE value = 'roles')
  AND NOT EXISTS (SELECT 1 FROM json_each(`guild_setup`.`categories`) WHERE value = 'community');--> statement-breakpoint
UPDATE `guild_setup`
SET `categories` = json_insert(`categories`, '$[#]', 'roles')
WHERE EXISTS (SELECT 1 FROM json_each(`guild_setup`.`categories`) WHERE value = 'community')
  AND NOT EXISTS (SELECT 1 FROM json_each(`guild_setup`.`categories`) WHERE value = 'roles');
