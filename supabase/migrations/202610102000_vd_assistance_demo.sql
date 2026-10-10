-- VD Assistance (app iPhone des clients des garages, Olivier 10/10/2026) : garage de démonstration pour la
-- validation d'Apple. Ses commandes ne partent jamais au dispatch (ni notification, ni appel).
alter table espace_societes add column if not exists demo boolean not null default false;

notify pgrst, 'reload schema';
