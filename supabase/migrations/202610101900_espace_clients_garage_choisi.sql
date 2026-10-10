-- Clients des garages (Olivier 10/10/2026) : à l'inscription, le client choisit SON garage parmi ceux de la société
-- (pas d'adresse libre). Ses commandes sont livrées à ce garage, ce qui garantit au garage que le client lui revient.
alter table espace_clients
  add column if not exists garage_id uuid references espace_garages(id) on delete set null;

notify pgrst, 'reload schema';
