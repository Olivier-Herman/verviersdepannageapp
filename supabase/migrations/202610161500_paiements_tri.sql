-- Paiements fournisseurs (Olivier 16/10/2026) : 13 h 30, jours ouvrables, Olivier SEUL est prévenu qu'il y a des
-- factures à trier (Momo ne reçoit pas cette notification ; lui ne reçoit que la liste d'attente à 14 h 30).
insert into public.app_settings (key, value)
values ('paiements_tri_user_ids', '["29df3445-f452-4ebc-a7bb-c16a8377289b"]')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
