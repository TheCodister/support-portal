CREATE TABLE knowledge_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200), body text NOT NULL CHECK (char_length(body) <= 100000),
  author_id uuid NOT NULL REFERENCES users(id), updated_by uuid NOT NULL REFERENCES users(id),
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, author_id) REFERENCES memberships(organization_id, user_id),
  FOREIGN KEY (organization_id, updated_by) REFERENCES memberships(organization_id, user_id)
);
CREATE INDEX knowledge_articles_org_cursor_idx ON knowledge_articles (organization_id, updated_at DESC, id DESC);
CREATE INDEX knowledge_articles_search_idx ON knowledge_articles USING gin (to_tsvector('english', title || ' ' || body));
CREATE TABLE knowledge_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL REFERENCES users(id), object_key text UNIQUE NOT NULL,
  file_name text NOT NULL, content_type text NOT NULL, size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  state upload_state NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, uploader_id) REFERENCES memberships(organization_id, user_id)
);
