    -- supabase/migrations/202606181100_accept_reminder.sql
    --
    -- Olivier 2026-06-18 : rappel d'acceptation. Quand une mission est assignée à un
    -- chauffeur mais qu'il ne l'accepte pas, un cron lui renvoie une notification de
    -- rappel. On trace l'envoi pour éviter le spam.

    ALTER TABLE public.incoming_missions
      ADD COLUMN IF NOT EXISTS accept_reminder_at    TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS accept_reminder_count SMALLINT NOT NULL DEFAULT 0;

    NOTIFY pgrst, 'reload schema';
