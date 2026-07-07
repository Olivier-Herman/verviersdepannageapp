-- Lien entre une demande TGR Touring acceptée et la mission VD Soft créée au
-- planning du dispatch (onglet RDV / En attente) à la date prévue. Permet de
-- naviguer TGR → mission et d'éviter les doublons. Olivier 2026-07-07.
alter table public.tgr_missions
  add column if not exists dispatch_mission_id uuid
    references public.incoming_missions(id) on delete set null;

notify pgrst, 'reload schema';
