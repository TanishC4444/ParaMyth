-- Explicit, one-time cutover. Run after 001 in the same transaction, with the
-- migration advisory lock held. Stop legacy writers before running this file.
-- The source is retained; no credentials or password hashes leave PostgreSQL.
DO $migration$
DECLARE
    table_name text;
    columns_sql text;
    has_rows boolean;
    differs boolean;
    tables text[] := ARRAY['users', 'studios', 'memberships', 'invitations',
                           'projects', 'project_revisions', 'comments', 'auth_limits'];
BEGIN
    IF EXISTS (SELECT 1 FROM paramyth.schema_migrations WHERE version = 2) THEN
        RETURN;
    END IF;
    IF to_regclass('storyforge.users') IS NULL THEN
        RAISE EXCEPTION 'Legacy storyforge account tables are missing';
    END IF;

    -- Lock all sources before copying for a consistent snapshot. A short
    -- lock_timeout is set by the migration runner; busy databases fail safely.
    FOREACH table_name IN ARRAY tables LOOP
        EXECUTE format('LOCK TABLE storyforge.%I IN SHARE MODE', table_name);
        EXECUTE format('LOCK TABLE paramyth.%I IN ACCESS EXCLUSIVE MODE', table_name);
    END LOOP;
    LOCK TABLE paramyth.sessions IN ACCESS EXCLUSIVE MODE;
    FOREACH table_name IN ARRAY tables || ARRAY['sessions'] LOOP
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM paramyth.%I)', table_name) INTO has_rows;
        IF has_rows THEN
            RAISE EXCEPTION 'ParaMyth destination must be empty; reconcile existing accounts and teams before importing';
        END IF;
    END LOOP;

    FOREACH table_name IN ARRAY tables LOOP
        SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
          INTO columns_sql
          FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = format('paramyth.%I', table_name)::regclass
            AND a.attnum > 0 AND NOT a.attisdropped;
        EXECUTE format('INSERT INTO paramyth.%I (%s) SELECT %s FROM storyforge.%I',
                       table_name, columns_sql, columns_sql, table_name);
        EXECUTE format('SELECT EXISTS ((SELECT %s FROM storyforge.%I EXCEPT ALL SELECT %s FROM paramyth.%I)
                       UNION ALL (SELECT %s FROM paramyth.%I EXCEPT ALL SELECT %s FROM storyforge.%I))',
                       columns_sql, table_name, columns_sql, table_name,
                       columns_sql, table_name, columns_sql, table_name) INTO differs;
        IF differs THEN
            RAISE EXCEPTION 'Legacy import validation failed';
        END IF;
    END LOOP;
    -- Legacy sf_ sessions are not valid pm_ sessions. Users sign in again with
    -- their unchanged password; sessions in the source schema remain intact.
    INSERT INTO paramyth.schema_migrations(version) VALUES (2);
END
$migration$;
