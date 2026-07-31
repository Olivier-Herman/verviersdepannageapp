-- Réception i18n : borne visiteur bilingue FR/EN (défaut FR).
-- Motifs : libellé EN en plus du FR (label). Interactions : langue du visiteur.
alter table reception_motifs   add column if not exists label_en text;
alter table fiche_interactions add column if not exists lang text not null default 'fr';   -- fr | en

-- Traductions EN du jeu de départ (best-effort, éditable en admin ensuite).
update reception_motifs set label_en = case label
  when 'Récupérer des effets'   then 'Collect belongings'
  when 'Voir le véhicule'        then 'See the vehicle'
  when 'Paiement / restitution'  then 'Payment / release'
  when 'Rendez-vous'             then 'Appointment'
  when 'Administratif'           then 'Administrative'
  when 'Autre'                   then 'Other'
  when 'Nouvelle mission'        then 'New job'
  when 'Appel privé'             then 'Private call'
  else label_en end
where label_en is null;

notify pgrst, 'reload schema';
