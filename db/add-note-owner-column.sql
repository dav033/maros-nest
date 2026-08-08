-- Standalone notes (no entity_kind) can be private to their creator.
-- Notes linked to a lead/project/contact/company stay shared regardless of owner_id —
-- the whole point of attaching a note to a CRM entity is that the team working it sees it.
--
-- Existing notes get owner_id = NULL, which reads as "shared/legacy": nobody recorded
-- who created them before this column existed, so they stay visible to everyone with
-- notes:read, same as today. Only notes created after this migration have a real
-- owner and can be private. Not even an admin can read another user's private note —
-- notes:read only ever gated the module, never bypassed per-note ownership.
ALTER TABLE note_pages ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_note_pages_owner ON note_pages (owner_id);
