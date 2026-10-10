-- Créneau de dépôt accepté par le garage d'une source (Olivier 10/10/2026). EBAC et Centracar : lundi à vendredi,
-- 9 h - 16 h, hors jours fériés. Hors créneau, une alerte à confirmer s'affiche au chauffeur dès que la mission est un
-- remorquage (le véhicule va en parc chez nous) ; rien pour un dépannage sur place ou dans le créneau.
alter table mission_source_catalog add column if not exists depot_horaires jsonb;
alter table incoming_missions
  add column if not exists source_notice_ack_at timestamptz,
  add column if not exists source_notice_ack_by uuid;

update mission_source_catalog set
  depot_horaires = '{"jours":[1,2,3,4,5],"de":9,"a":16,"feries":false}'::jsonb,
  driver_notice = 'Le garage n’accepte les dépôts que du lundi au vendredi, de 9 h à 16 h (jours ouvrables). Nous sommes en dehors de ces heures : ne dépose pas le véhicule au garage, mets-le en parc chez nous (ou appelle le dispatch).',
  driver_notice_sq = 'Garazhi pranon dorëzime vetëm nga e hëna deri të premten, nga ora 9 deri në 16 (ditë pune). Tani jemi jashtë këtyre orëve: mos e dorëzo automjetin në garazh, vendose në parkun tonë (ose telefono dispeçerin).'
where key in ('garage_4e50c4', 'garage_14528a', 'garage_4e50c4_clients', 'garage_14528a_clients');

notify pgrst, 'reload schema';
