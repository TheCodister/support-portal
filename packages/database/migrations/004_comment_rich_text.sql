ALTER TABLE comments ADD COLUMN body_format text NOT NULL DEFAULT 'text' CHECK (body_format IN ('text', 'markdown'));
ALTER TABLE ticket_images ADD COLUMN comment_id uuid;
ALTER TABLE ticket_images ADD FOREIGN KEY (organization_id, comment_id) REFERENCES comments(organization_id, id) ON DELETE CASCADE;
