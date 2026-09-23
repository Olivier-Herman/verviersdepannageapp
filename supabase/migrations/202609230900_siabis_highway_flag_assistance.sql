-- Olivier 23/09/2026 (2AGV585, Ethias via Kaze, E25 aire de Sprimont) : « tu sais
-- lire les couvert / non couvert, je ne comprends pas pourquoi il y a un
-- tranchage ». Une mission envoyée par un assisteur est couverte par lui, sauf
-- si la demande dit le contraire (detectNonCouvert → police_snc à l'intake).
-- Le drapeau « autoroute : Siabis à trancher » ne se lève donc plus pour les
-- sources taguées « assistance » au catalogue ; il reste pour le privé, les
-- garages et les sources inconnues, où le payeur n'est pas établi.
create or replace function flag_highway_siabis() returns trigger as $$
begin
  if OLD.status = 'new'
     and NEW.status is distinct from OLD.status
     and NEW.status not in ('new', 'cancelled', 'ignored', 'parse_error')
     and coalesce(NEW.siabis_reviewed, false) = false
     and coalesce(NEW.source, '') not in ('sia_couvert','police_snc','police_saisie','police_mal_garee','appel_police_accident')
     and coalesce(NEW.source, '') not like 'police%'
     and not exists (
       select 1 from mission_source_catalog c
       where c.key = NEW.source and 'assistance' = any(c.tags)
     )
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
