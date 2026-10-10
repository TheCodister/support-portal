CREATE TABLE announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('news', 'maintenance', 'incident')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200), body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  ends_at timestamptz, author_id uuid NOT NULL REFERENCES users(id), updated_by uuid NOT NULL REFERENCES users(id),
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, author_id) REFERENCES memberships(organization_id, user_id),
  FOREIGN KEY (organization_id, updated_by) REFERENCES memberships(organization_id, user_id)
);
CREATE INDEX announcements_org_cursor_idx ON announcements (organization_id, created_at DESC, id DESC);
