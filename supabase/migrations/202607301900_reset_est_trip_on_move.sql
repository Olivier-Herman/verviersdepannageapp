-- Recalcul automatique de la durée par défaut (est_trip_min) à l'édition d'une
-- fiche : dès que les coordonnées d'intervention OU le dépôt de départ changent,
-- on invalide est_trip_min. Le cron estimate-police-trips le recalcule ensuite.
-- Couvre TOUS les points d'édition (dispatch, chauffeur, QR…) en un seul endroit.

create or replace function reset_est_trip_on_move()
returns trigger
language plpgsql
as $$
begin
  if (new.incident_lat        is distinct from old.incident_lat)
  or (new.incident_lng        is distinct from old.incident_lng)
  or (new.departure_depot_id  is distinct from old.departure_depot_id)
  or (new.depot_depart_id     is distinct from old.depot_depart_id) then
    new.est_trip_min := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reset_est_trip on incoming_missions;
create trigger trg_reset_est_trip
  before update on incoming_missions
  for each row
  execute function reset_est_trip_on_move();
