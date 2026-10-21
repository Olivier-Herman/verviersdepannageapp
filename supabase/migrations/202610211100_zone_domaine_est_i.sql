-- La zone Domaine du parc est la zone I (Olivier 21/10/2026) : on retire la zone « Domaine »
-- créée le matin même par 202610211000_controle_parc.sql (aucun véhicule n'y a été rangé).
delete from public.parc_zones z
where z.key = 'Domaine'
  and not exists (select 1 from public.incoming_missions m where m.parc_zone_key = 'Domaine');

notify pgrst, 'reload schema';
