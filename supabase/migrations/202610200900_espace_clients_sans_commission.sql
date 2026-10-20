-- Clients des garages (Momo, 20/10/2026) : plus de commission au garage sur ses clients sans assistance ;
-- la contrepartie est le remorquage vers son garage, qui garde la réparation.
update public.app_settings set value = '0' where key = 'espace_clients_commission_pct';

notify pgrst, 'reload schema';
