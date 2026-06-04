-- Maya's Tier-1 Support harness: durable state schema (Postgres / Neon).
-- Five tables: sessions, runs, traces, artifacts, audit_log.
-- Tables are schema-qualified (public.*) so the code never relies on a
-- search_path server setting, which the Neon -pooler endpoint drops.

CREATE TABLE IF NOT EXISTS public.sessions (
    id          TEXT PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.runs (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES public.sessions(id),
    input_message   TEXT NOT NULL,
    output_message  TEXT,
    used_sandbox    BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.traces (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id      TEXT NOT NULL REFERENCES public.runs(id),
    payload     JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.artifacts (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id      TEXT NOT NULL REFERENCES public.runs(id),
    object_key  TEXT NOT NULL,
    url         TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_log (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id      TEXT REFERENCES public.runs(id),
    event       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_runs_session ON public.runs(session_id);
CREATE INDEX IF NOT EXISTS idx_runs_created ON public.runs(created_at);
CREATE INDEX IF NOT EXISTS idx_traces_run ON public.traces(run_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_run ON public.artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_audit_run ON public.audit_log(run_id);
