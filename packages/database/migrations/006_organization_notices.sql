-- At most one notice per organization: the primary key is the organization itself.
CREATE TABLE organization_notices (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('released', 'maintenance', 'incident')),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500),
  updated_by uuid NOT NULL REFERENCES users(id), version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, updated_by) REFERENCES memberships(organization_id, user_id)
);
