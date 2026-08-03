-- Détection Siabis/autoroute (chantier 1) : drapeau posé AUTOMATIQUEMENT quand
-- une mission quitte le statut 'new' vers un autre (sauf cancel/ignored/parse_error),
-- par N'IMPORTE QUEL chemin, si son adresse d'intervention est autoroutière et que
-- la source n'est pas déjà Siabis/police. Le drapeau pilote l'ouverture du modal
-- (fiche + dispatch) et le garde-fou facturation. Levé quand le dispatch tranche.

alter table incoming_missions add column if not exists needs_siabis_decision boolean not null default false;

create or replace function flag_highway_siabis() returns trigger as $$
begin
  if OLD.status = 'new'
     and NEW.status is distinct from OLD.status
     and NEW.status not in ('new', 'cancelled', 'ignored', 'parse_error')
     and coalesce(NEW.source, '') not in ('sia_couvert','police_snc','police_saisie','police_mal_garee','appel_police_accident')
     and coalesce(NEW.source, '') not like 'police%'
     and NEW.incident_address is not null
     and (
          NEW.incident_address ~* '\y(autoroute|voie rapide|bretelle)\y'
       or NEW.incident_address ~* '\yaire\s+d'
       or NEW.incident_address ~* '\y[ae] ?0*[0-9]{1,3}[a-z]?\y'
       or NEW.incident_address ~* '\y(b|p)\.?\s?k\y'
     )
  then
    NEW.needs_siabis_decision := true;
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_flag_highway_siabis on incoming_missions;
create trigger trg_flag_highway_siabis
  before update on incoming_missions
  for each row execute function flag_highway_siabis();

notify pgrst, 'reload schema';
