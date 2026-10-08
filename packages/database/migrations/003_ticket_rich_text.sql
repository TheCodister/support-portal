ALTER TABLE tickets ADD COLUMN description_format text NOT NULL DEFAULT 'text' CHECK (description_format IN ('text', 'markdown'));
CREATE TABLE ticket_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id uuid, uploader_id uuid NOT NULL REFERENCES users(id), object_key text UNIQUE NOT NULL,
  file_name text NOT NULL, content_type text NOT NULL, size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  state upload_state NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, ticket_id) REFERENCES tickets(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, uploader_id) REFERENCES memberships(organization_id, user_id)
);
CREATE INDEX ticket_images_ticket_idx ON ticket_images (organization_id, ticket_id);
