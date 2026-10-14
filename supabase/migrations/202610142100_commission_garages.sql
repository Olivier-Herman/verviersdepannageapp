-- Note de commission des garages (Olivier 14/10/2026) : Car Avenue Star (partenaire 37), 15 %, factures
-- à partir du 14/10/2026 (les précédentes avaient leur note en extourne).
insert into public.app_settings (key, value)
values ('commission_garages', '["37|15|2026-10-14"]')
on conflict (key) do nothing;

notify pgrst, 'reload schema';
