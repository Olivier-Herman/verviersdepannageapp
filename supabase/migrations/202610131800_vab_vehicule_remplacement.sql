-- Livraison de véhicule de remplacement (VR) VAB — Olivier 13/10/2026.
--
-- VAB envoie pour un même dossier une action « Livraison véhicule de remplacement » et une action
-- « Remorquage ». La livraison devient des étapes de la fiche remorquage (prise du VR chez le
-- concessionnaire → livraison chez le client), tous les km comptés, plus un forfait VR (grille VAB
-- 2026 : « frais administratif livraison / récup »). Remorquage déjà clôturé : nouvelle mission,
-- forfait VR + tous les km.

-- Infos du VR sur la fiche : { aid, dossier, plate, pickup {name, address, lat, lng},
-- deliver {name, address, phone}, placement 'before'|'after'|'to_decide', standalone, added_at }.
alter table public.incoming_missions add column if not exists vab_vr jsonb;
comment on column public.incoming_missions.vab_vr is
  'Livraison de véhicule de remplacement VAB rattachée à la fiche (ou fiche de livraison seule si standalone=true).';

-- Case du dispatch (Olivier 13/10/2026) : forcer (true) ou retirer (false) le forfait VR ;
-- NULL = la détection automatique (vab_vr) décide.
alter table public.incoming_missions add column if not exists vr_forfait boolean;

-- Forfait VR par créneau (grille VAB 2026) : jour = lun-ven 7h-19h ; soir = 19h-24h, 5h-7h,
-- week-end et fériés ; nuit = 24h-5h tous les jours.
insert into public.app_settings (key, value)
values ('vab_forfait_vr', '["jour|36.34","soir|50.28","nuit|58.14"]')
on conflict (key) do nothing;

-- Livraison de VR seule (remorquage déjà clôturé) : tous les km au tarif km VAB, sans forfait
-- de départ ; le forfait VR s'ajoute en ligne distincte. Créneaux : majorations VAB habituelles
-- (surcharge_schedules), qui redonnent 1,62 € et 1,87 € du km.
insert into public.source_tariffs (source, mission_type, unit_price, km_inclus, km_price, surcharge_night_pct,
  surcharge_we_pct, surcharge_holiday_pct, conditions, is_autofac, effective_from, km_basis, pricing_mode, notes)
select 'vab', 'transport', 0, 0, 1.17, 0, 0, 0,
  'Livraison de véhicule de remplacement seule : tous les km (forfait VR en ligne distincte)', false,
  '2026-02-01', 'total', 'forfait', 'Olivier 13/10/2026 — livraison VR quand le remorquage est déjà clôturé.'
where not exists (select 1 from public.source_tariffs where source = 'vab' and mission_type = 'transport');

notify pgrst, 'reload schema';
