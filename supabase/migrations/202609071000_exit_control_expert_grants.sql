-- 202609071000_exit_control_expert_grants
--
-- Les tables du contrôle de sortie (202609051200) et de l'accès experts
-- (202609051600) ont été créées avec RLS ON mais SANS grant : service_role
-- recevait « permission denied for table » → aucune fiche ne s'armait, aucun
-- expert ne pouvait s'inscrire (popup jamais émis). Olivier 2026-09-07.
-- Tables serveur-only : RLS ON sans policy + grant service_role uniquement.

grant all on public.mission_exit_control  to service_role;
grant all on public.mission_documents     to service_role;
grant all on public.capture_tokens        to service_role;
grant all on public.expert_devices        to service_role;
grant all on public.expert_device_bureaus to service_role;

revoke all on public.mission_exit_control  from anon, authenticated;
revoke all on public.mission_documents     from anon, authenticated;
revoke all on public.capture_tokens        from anon, authenticated;
revoke all on public.expert_devices        from anon, authenticated;
revoke all on public.expert_device_bureaus from anon, authenticated;

notify pgrst, 'reload schema';
