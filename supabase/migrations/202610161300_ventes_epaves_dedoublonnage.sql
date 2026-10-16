-- Registre « Vente d'épaves » (Domaine) : un véhicule vendu = UNE ligne (Olivier 16/10/2026).
-- Un mail de Rosemarie déplacé de dossier (ex. « A traiter par Mobi ») change d'identifiant chez Outlook :
-- le robot le relisait comme un nouveau mail et ajoutait chaque véhicule une seconde fois (94 doublons au
-- 16/10, total du 3e trimestre affiché 5 182 € au lieu de 2 813 €). La clé devient (date de vente, châssis).

-- 1. On garde, par (date de vente, châssis), la ligne qui porte le plus d'informations saisies à la main
--    (Date OUT corrigée, préparation, sortie réelle), sinon la plus ancienne.
with ranked as (
  select id,
         row_number() over (
           partition by vente_date, vin
           order by (date_out is not null)::int + (prepare_at is not null)::int + (sortie_reelle_date is not null)::int desc,
                    created_at asc, id asc
         ) as rn
  from public.domaine_ventes_epaves
  where vente_date is not null and vin is not null
)
delete from public.domaine_ventes_epaves d
using ranked r
where d.id = r.id and r.rn > 1;

-- 2. Unicité sur (date de vente, châssis) ; l'ancienne clé (mail, châssis) ne protégeait de rien.
drop index if exists public.uq_ventes_epaves_email_vin;
create unique index if not exists uq_ventes_epaves_vente_vin on public.domaine_ventes_epaves (vente_date, vin);

notify pgrst, 'reload schema';
