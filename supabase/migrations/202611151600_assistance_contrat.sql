-- Contrat de l'assistance affiché sur la fiche (dispatch + chauffeur), lu sur la plateforme de l'assistance.
-- Olivier 15/11/2026.
alter table public.incoming_missions add column if not exists assistance_contrat jsonb;
comment on column public.incoming_missions.assistance_contrat is 'Contrat de l''assistance (nom, couvert, police, plafond, franchise, VR, couverture, consignes) — src/lib/assistance/contrat.ts';
notify pgrst, 'reload schema';
