CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE membership_role AS ENUM ('requester', 'agent', 'admin');
CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'waiting', 'closed');
CREATE TYPE ticket_priority AS ENUM ('low', 'normal', 'high', 'urgent');
CREATE TYPE comment_visibility AS ENUM ('public', 'internal');
CREATE TYPE upload_state AS ENUM ('pending', 'available', 'failed');

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identity_ref text UNIQUE NOT NULL,
  email text UNIQUE NOT NULL, display_name text NOT NULL, password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role membership_role NOT NULL, PRIMARY KEY (organization_id, user_id)
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);
CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES users(id), assignee_id uuid REFERENCES users(id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200), description text NOT NULL,
  status ticket_status NOT NULL DEFAULT 'open', priority ticket_priority NOT NULL DEFAULT 'normal',
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, requester_id) REFERENCES memberships(organization_id, user_id),
  FOREIGN KEY (organization_id, assignee_id) REFERENCES memberships(organization_id, user_id)
);
CREATE INDEX tickets_org_status_cursor_idx ON tickets (organization_id, status, created_at DESC, id DESC);
CREATE INDEX tickets_org_assignee_cursor_idx ON tickets (organization_id, assignee_id, created_at DESC, id DESC);
CREATE INDEX tickets_search_idx ON tickets USING gin (to_tsvector('english', title || ' ' || description));
CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, ticket_id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES users(id), visibility comment_visibility NOT NULL DEFAULT 'public', body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, ticket_id) REFERENCES tickets(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, author_id) REFERENCES memberships(organization_id, user_id)
);
CREATE INDEX comments_ticket_idx ON comments (organization_id, ticket_id, created_at, id);
CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, ticket_id uuid NOT NULL,
  comment_id uuid, uploader_id uuid NOT NULL REFERENCES users(id), object_key text UNIQUE NOT NULL,
  file_name text NOT NULL, content_type text NOT NULL, size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  state upload_state NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, ticket_id) REFERENCES tickets(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, comment_id) REFERENCES comments(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, uploader_id) REFERENCES memberships(organization_id, user_id)
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id), action text NOT NULL, entity_type text NOT NULL, entity_id uuid NOT NULL,
  data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_events (organization_id, entity_type, entity_id, created_at DESC);
CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type text NOT NULL, aggregate_id uuid NOT NULL, payload jsonb NOT NULL, attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz, last_error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox_events (available_at, created_at) WHERE published_at IS NULL;
CREATE TABLE job_executions (
  job_id uuid PRIMARY KEY, event_type text NOT NULL, state text NOT NULL, result_location text,
  completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
