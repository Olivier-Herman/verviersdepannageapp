-- Pilotes nommés sur un flag en préversion (Olivier 07/09/2026 : « ouvrir les
-- nouveaux écrans à Jona également »). En mode 'superadmin', les users listés
-- ici voient aussi la préversion ; en 'off' personne, en 'all' tout le monde.
alter table public.feature_flags
  add column if not exists pilot_user_ids uuid[] not null default '{}';

update public.feature_flags
   set pilot_user_ids = array['eda29707-c9c7-47b5-ab21-084ea22201bc']::uuid[],
       updated_at = now()
 where key in ('dossier_view', 'fourriere_gardiennage')
   and not ('eda29707-c9c7-47b5-ab21-084ea22201bc'::uuid = any(pilot_user_ids));

update public.feature_flags set label = 'Fourrière sur les fiches Gardiennage (parc, à relivrer)'
 where key = 'fourriere_gardiennage' and label is null;

notify pgrst, 'reload schema';
