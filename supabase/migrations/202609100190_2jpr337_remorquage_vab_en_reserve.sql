-- 09/09/2026 — Olivier : « la voiture est en parc et pas encore prête à partir en
-- relivraison, donc le dossier doit être en parc jusqu'à ce que Momo crée la
-- relivraison et l'assigne ». Le remorquage VAB 56373028 (fiche #10137465), rattaché
-- au dossier 2JPR337, sort du dispatch et reste en réserve sur le dossier : la
-- création de la relivraison depuis « À relivrer » le reprendra (même fiche, même
-- référence VAB) au lieu d'en créer une nouvelle.
update incoming_missions
   set status = 'ignored', assigned_to = null, updated_at = now()
 where mission_number = 10137465 and status = 'dispatching';
insert into mission_logs (mission_id, action, notes, metadata)
select id, 'note', 'Mis en réserve sur le dossier 2JPR337 : le véhicule est au parc, pas prêt. La fiche sera reprise telle quelle quand Momo créera la relivraison depuis « À relivrer » (Olivier 09/09).', '{"reserve_rel": true}'::jsonb
  from incoming_missions where mission_number = 10137465;
insert into mission_logs (mission_id, action, notes)
select id, 'note', 'Remorquage VAB 56373028 (#10137465) en réserve : il redeviendra la relivraison du dossier quand elle sera créée depuis « À relivrer ».'
  from incoming_missions where mission_number = 10136533;
