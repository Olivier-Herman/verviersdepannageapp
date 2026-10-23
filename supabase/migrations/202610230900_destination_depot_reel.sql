-- Destination d'une mise au parc = adresse officielle du dépôt RÉEL de la zone (Olivier 23/10/2026).
-- Audit du 23/10 : 38 fiches indiquaient « Rue de la Cité 22a, Verviers » (adresse que nous envoie IMA/Kaze)
-- alors que le véhicule était au parc de Pepinster ; Pepinster écrit sous 3 formes (Lefin 12 / 12 Belgique / 18).
-- Quand un véhicule est mis au parc (ou change de zone) et que sa destination est vide ou désigne l'un de nos
-- dépôts, elle devient l'adresse du dépôt de la zone (depots.address : Pepinster = Rue Lefin 12, 4860 Pepinster).
-- Nouvelles missions uniquement (créées à partir du 23/10/2026) : les anciennes fiches ne bougent pas.
-- La zone T (chez le garagiste) est ignorée : le véhicule n'est pas chez nous.

create or replace function dossier_destination_depot_reel() returns trigger
language plpgsql as $$
declare
  v_addr text; v_lat double precision; v_lng double precision;
begin
  begin
    if new.dossier_leg or new.source = 'gardiennage' then return new; end if;
    if new.status is distinct from 'parked' or new.parc_zone_key is null or new.parc_zone_key = 'T' then return new; end if;
    if new.created_at < timestamptz '2026-10-23 00:00:00+02' then return new; end if;
    if tg_op = 'UPDATE' and old.status is not distinct from 'parked' and old.parc_zone_key is not distinct from new.parc_zone_key then return new; end if;
    if coalesce(btrim(new.destination_address), '') <> ''
       and lower(new.destination_address) !~ '(verviers d[ée]pannage|cit[ée] ?22|lefin|ti[eè]ge ?107)' then return new; end if;
    select d.address, d.lat, d.lng into v_addr, v_lat, v_lng
      from parc_zones z join depots d on d.id = z.depot_id
      where z.key = new.parc_zone_key limit 1;
    if v_addr is null then return new; end if;
    new.destination_address := v_addr;
    if v_lat is not null and v_lng is not null then new.destination_lat := v_lat; new.destination_lng := v_lng; end if;
  exception when others then
    raise warning '[dossier_destination_depot_reel] mission % : %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists trg_dossier_destination_depot_reel on incoming_missions;
create trigger trg_dossier_destination_depot_reel
  before insert or update of status, parc_zone_key on incoming_missions
  for each row execute function dossier_destination_depot_reel();

notify pgrst, 'reload schema';
