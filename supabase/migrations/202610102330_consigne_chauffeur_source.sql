-- Consigne affichée au chauffeur sur toute mission d'une source (Olivier 10/10/2026) : EBAC et Centracar n'acceptent
-- les dépôts que du lundi au vendredi, 9 h - 16 h, jours ouvrables (demande de Justin Emontspool du 09/10).
-- Donnée de la source, pas de condition codée sur la source ; français + albanais (app chauffeur bilingue).
alter table mission_source_catalog
  add column if not exists driver_notice text,
  add column if not exists driver_notice_sq text;

update mission_source_catalog set
  driver_notice = 'Dépôt au garage uniquement du lundi au vendredi, de 9 h à 16 h (jours ouvrables). En dehors de ces heures, ne dépose pas : appelle le dispatch.',
  driver_notice_sq = 'Dorëzimi në garazh vetëm nga e hëna deri të premten, nga ora 9 deri në 16 (ditë pune). Jashtë këtyre orëve mos e dorëzo: telefono dispeçerin.'
where key in ('garage_4e50c4', 'garage_14528a', 'garage_4e50c4_clients', 'garage_14528a_clients') and driver_notice is null;

notify pgrst, 'reload schema';
