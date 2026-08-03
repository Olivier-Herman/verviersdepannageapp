-- Siabis/autoroute : décision PRISE AU DISPATCH avant d'envoyer le chauffeur.
-- `siabis_reviewed` = le dispatch a tranché (couvert / non couvert / normal) → on
-- ne re-marque plus la mission même si la source reste normale.

alter table incoming_missions add column if not exists siabis_reviewed boolean not null default false;

create or replace function flag_highway_siabis() returns trigger as $$
begin
  if OLD.status = 'new'
     and NEW.status is distinct from OLD.status
     and NEW.status not in ('new', 'cancelled', 'ignored', 'parse_error')
     and coalesce(NEW.siabis_reviewed, false) = false          -- pas déjà tranché
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

notify pgrst, 'reload schema';
