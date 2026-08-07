-- Touring COMEX : garder l'HISTORIQUE des actions d'un dossier sur UNE fiche
-- VD Soft. Touring envoie plusieurs actions sur le même CID_DOS avec un
-- CID_SEQ_ACTION incrémenté (200 = REM initiale, 201 = complément/VR…). On les
-- neutralisait à tort comme doublons. On les stocke désormais toutes ici, et le
-- raw_content de la fiche porte l'action ACTIVE (celle qui vit chez Touring),
-- pour que la clôture (detail/set + operType) cible le bon seq.
--
-- Forme : [{ seq, external_id, role:'first'|'followup', received_at, closed_at, raw }]
alter table public.incoming_missions
  add column if not exists touring_actions jsonb;

notify pgrst, 'reload schema';
