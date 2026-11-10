-- Dernier recours avant d'abandonner la partie Parquet d'une saisie (Olivier 10/11/2026) : après deux relances à
-- l'agent restées sans réquisitoire, le robot demande UNE fois au Parquet une copie du réquisitoire. 7 jours plus
-- tard sans réponse, la partie Parquet est abandonnée (seule la partie Domaine est facturée).
alter table public.saisie_dossiers add column if not exists requisitoire_parquet_demande_at timestamptz;

notify pgrst, 'reload schema';
