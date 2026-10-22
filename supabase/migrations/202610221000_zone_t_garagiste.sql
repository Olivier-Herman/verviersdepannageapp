-- Zone T « Tango » : véhicule parti chez le garagiste (Olivier 22/10/2026).
-- Levée de saisie TEMPORAIRE : le garagiste vient chercher la voiture pour la réparer et la ramener avant la
-- levée définitive. Il paie le dépannage + le gardiennage jusqu'au jour où il la prend (facture client).
--   • transfert en zone T → le gardiennage s'arrête (volet fermé, motif zone_t) ; date et garage notés ;
--   • retour (scan du QR, plaque ou châssis → une de nos zones) → nouveau gardiennage à partir du retour ;
--     un éventuel état de frais au Parquet ne compte que depuis le retour (client_billed_to_date = retour) ;
--   • 2 mois en T sans retour → sortie du parc « pas revenu de chez le garagiste » (cron zone-t).

insert into public.parc_zones (key, label, sort_order, depot_id, active)
select 'T', 'Chez le garagiste (levée temporaire)', 170, z.depot_id, true
from public.parc_zones z
where z.key = 'A' and not exists (select 1 from public.parc_zones t where t.key = 'T');

alter table public.incoming_missions
  add column if not exists zone_t_at     timestamptz,
  add column if not exists zone_t_garage text;
comment on column public.incoming_missions.zone_t_at is 'Départ chez le garagiste (zone T) : le gardiennage est arrêté depuis ce moment (Olivier 22/10/2026)';
comment on column public.incoming_missions.zone_t_garage is 'Garage qui a pris le véhicule (nom, téléphone) lors du passage en zone T';

create or replace function dossier_gardiennage_zone_t() returns trigger
language plpgsql as $$
declare
  v_open uuid;
begin
  begin
    if tg_op <> 'UPDATE' or new.dossier_leg or new.source = 'gardiennage' then return new; end if;
    if new.parc_zone_key is not distinct from old.parc_zone_key or new.status <> 'parked' then return new; end if;

    if new.parc_zone_key = 'T' then
      -- départ chez le garagiste : plus de gardiennage
      new.zone_t_at := coalesce(new.zone_t_at, now());
      update incoming_missions set parc_exit_at = now(), parc_exit_reason = 'zone_t', updated_at = now()
        where dossier_leg and parc_exit_at is null
          and (parent_mission_id = new.id or parc_origin_mission_id = new.id);
    elsif old.parc_zone_key = 'T' then
      -- retour chez nous : le gardiennage reprend à la date du retour
      new.zone_t_at := null;
      select id into v_open from incoming_missions
        where dossier_leg and parc_exit_at is null and (parent_mission_id = new.id or parc_origin_mission_id = new.id) limit 1;
      if v_open is null then
        perform dossier_gardiennage_open(new.id, now());
      end if;
      -- état de frais éventuel : seulement depuis le retour
      update saisie_dossiers set client_billed_to_date = greatest(coalesce(client_billed_to_date, current_date), current_date), updated_at = now()
        where mission_id = new.id;
    end if;
  exception when others then
    raise warning '[dossier_gardiennage_zone_t] mission % : %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists trg_dossier_gardiennage_zone_t on incoming_missions;
create trigger trg_dossier_gardiennage_zone_t
  before update of parc_zone_key on incoming_missions
  for each row execute function dossier_gardiennage_zone_t();

notify pgrst, 'reload schema';
