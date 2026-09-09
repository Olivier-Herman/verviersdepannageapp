-- 09/09/2026 soir — Olivier : « on commence par les plus rapides à clôturer ».
-- 1) VAB : la 3e fiche ancienne (#10130057, action 56314242) est absente de la liste
--    ouverte chez VAB (filet du 09/09 15:30 : 4 ouverts, 0 à traiter) → soldée ici,
--    comme les deux autres le matin. Chantier terminé : 100 % de clôtures autonomes
--    depuis le 03/09 ; reste sous surveillance le login navigateur intermittent.
update incoming_missions set vab_closed_at = now(), updated_at = now()
 where mission_number = 10130057 and vab_closed_at is null;
insert into mission_logs (mission_id, action, notes, metadata)
select id, 'vab_closed', 'VAB : dossier absent de la liste ouverte chez VAB (filet du 09/09 15:30, 0 à traiter) → déjà clôturé chez eux, marqué soldé ici.', '{"auto": false, "by": "Claude"}'::jsonb
  from incoming_missions where mission_number = 10130057;
INSERT INTO chantiers (key, title, status, note, updated_at, updated_by) VALUES
  ('vab', 'VAB — fiabilisation', 'fini',
   'Terminé le 09/09 : 100 % des remorquages clôturés seuls chez VAB depuis le 03/09 (filet toutes les 30 min sur la liste ouverte de VAB, reprise après compte occupé / écran des codes). Les 3 fiches anciennes sont soldées (absentes de la liste ouverte VAB). Nouveau le 09/09 : un remorquage VAB pour un véhicule déjà au parc se met en réserve sur le dossier (règle commune à toutes les assistances). Sous surveillance : le login navigateur intermittent (repli cookies HTTP en place).', now(), 'Claude')
ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now(), updated_by = 'Claude';
INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Clôturé : 100 % de clôtures autonomes depuis le 03/09, dernière fiche ancienne soldée (#10130057 absente de la liste ouverte VAB).' FROM chantiers WHERE key = 'vab';
-- 2) Annulation garage — notification : branchée (type garage_cancel_request, push + in-app aux dispatchers, lien vers Annulations garages).
INSERT INTO chantiers (key, title, status, note, updated_at, updated_by) VALUES
  ('garage-notif', 'Annulation garage — notification', 'fini',
   'Terminé le 09/09 : quand un garage demande l''annulation d''une mission déjà acceptée, les dispatchers reçoivent la notification (push + centre de notifications, type « Annulation demandée par un garage », activé par défaut) avec le lien vers la page Annulations garages où se prend la décision.', now(), 'Claude')
ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now(), updated_by = 'Claude';
INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Notification aux dispatchers branchée sur la demande d''annulation garage (push + in-app, lien vers la page de décision).' FROM chantiers WHERE key = 'garage-notif';
