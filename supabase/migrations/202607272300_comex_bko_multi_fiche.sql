-- COMEX BKO : un dossier peut correspondre à PLUSIEURS fiches VD Soft
-- (chaîne REM parent + REL enfant « -REL »). On stocke la liste des fiches à
-- clôturer + un détail d'affichage. vd_montant devient la SOMME des fiches.

alter table public.touring_comex_dossiers
  add column if not exists mission_ids jsonb,   -- [uuid, …] fiches à auto-facturer
  add column if not exists fiches      jsonb,   -- [{number, type, montant}, …] pour l'affichage
  add column if not exists fiche_count integer default 0;

notify pgrst, 'reload schema';
