-- Additive migration; ordinary PostgreSQL tables, not time-series hypertables.
-- Execute as the migration owner, never as the web application's runtime role.
CREATE SCHEMA IF NOT EXISTS paramyth;
CREATE TABLE IF NOT EXISTS paramyth.schema_migrations (
    version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS paramyth.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) <= 254),
    display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS paramyth.sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES paramyth.users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON paramyth.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON paramyth.sessions(expires_at);
CREATE TABLE IF NOT EXISTS paramyth.auth_limits (
    bucket text PRIMARY KEY, attempts integer NOT NULL, resets_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_limits_expiry_idx ON paramyth.auth_limits(resets_at);
CREATE TABLE IF NOT EXISTS paramyth.studios (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
    owner_id uuid NOT NULL REFERENCES paramyth.users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studios_owner_idx ON paramyth.studios(owner_id);
-- Ownership is a single non-null FK on studios; it cannot be lost via member edits.
CREATE TABLE IF NOT EXISTS paramyth.memberships (
    studio_id uuid NOT NULL REFERENCES paramyth.studios(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES paramyth.users(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (studio_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON paramyth.memberships(user_id);
CREATE TABLE IF NOT EXISTS paramyth.invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    studio_id uuid NOT NULL REFERENCES paramyth.studios(id) ON DELETE CASCADE,
    email text NOT NULL CHECK (email = lower(email)),
    role text NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
    token_hash text NOT NULL UNIQUE,
    created_by uuid NOT NULL REFERENCES paramyth.users(id) ON DELETE RESTRICT,
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invitations_studio_idx ON paramyth.invitations(studio_id);
CREATE INDEX IF NOT EXISTS invitations_creator_idx ON paramyth.invitations(created_by);
CREATE TABLE IF NOT EXISTS paramyth.projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    studio_id uuid NOT NULL REFERENCES paramyth.studios(id) ON DELETE CASCADE,
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    brief text NOT NULL DEFAULT '' CHECK (length(brief) <= 100000),
    manuscript text NOT NULL DEFAULT '' CHECK (length(manuscript) <= 1000000),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_by uuid NOT NULL REFERENCES paramyth.users(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_studio_idx ON paramyth.projects(studio_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS projects_editor_idx ON paramyth.projects(updated_by);
CREATE TABLE IF NOT EXISTS paramyth.project_revisions (
    project_id uuid NOT NULL REFERENCES paramyth.projects(id) ON DELETE CASCADE,
    version integer NOT NULL,
    title text NOT NULL, brief text NOT NULL, manuscript text NOT NULL,
    edited_by uuid NOT NULL REFERENCES paramyth.users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, version)
);
CREATE INDEX IF NOT EXISTS revisions_editor_idx ON paramyth.project_revisions(edited_by);
CREATE TABLE IF NOT EXISTS paramyth.comments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES paramyth.projects(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES paramyth.users(id) ON DELETE RESTRICT,
    body text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_project_idx ON paramyth.comments(project_id, created_at);
CREATE INDEX IF NOT EXISTS comments_user_idx ON paramyth.comments(user_id);
REVOKE ALL ON SCHEMA paramyth FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA paramyth FROM PUBLIC;
INSERT INTO paramyth.schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
