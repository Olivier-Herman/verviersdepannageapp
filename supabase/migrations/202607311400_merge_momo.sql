-- Fusion des deux comptes Momo en un seul (multi-identité Microsoft).
-- Canonique  : Momo Bureau VD  e7cbab7f-1d0a-4109-ab60-7b223d088b57 (session toujours ouverte)
-- Doublon    : Momo - VD       1b628f46-44ef-4a89-bdd7-a648e03f2154
-- On rattache l'identité momo@ au canonique, on réassigne TOUT l'historique
-- (toutes les FK vers users.id), puis on neutralise le doublon (active=false).
-- Olivier 2026-07-31.

do $$
declare
  r    record;
  dup  uuid := '1b628f46-44ef-4a89-bdd7-a648e03f2154';
  keep uuid := 'e7cbab7f-1d0a-4109-ab60-7b223d088b57';
begin
  -- 1) Dédoublonne les liens azure du doublon (garde un seul exemplaire).
  delete from user_auth_providers a using user_auth_providers b
   where a.user_id = dup and b.user_id = dup
     and a.provider = 'azure-ad' and b.provider = 'azure-ad'
     and a.ctid < b.ctid;

  -- 2) Réassigne dynamiquement toutes les références FK vers users(id) : dup -> keep.
  --    (mission_logs.actor_id, fiche_interactions.handled_by, user_competences, etc.)
  for r in
    select tc.table_schema as sch, tc.table_name as tbl, kcu.column_name as col
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and ccu.table_name = 'users' and ccu.column_name = 'id'
      and tc.table_name <> 'user_auth_providers'          -- géré à part (multi-identité)
      and tc.table_name <> 'user_competences'             -- géré à part (conflit de PK possible)
  loop
    execute format('update %I.%I set %I = %L where %I = %L', r.sch, r.tbl, r.col, keep, r.col, dup);
  end loop;

  -- 2b) Compétences : transfère sans dupliquer (PK user_id,motif_id).
  update user_competences uc set user_id = keep
   where uc.user_id = dup
     and not exists (select 1 from user_competences k where k.user_id = keep and k.motif_id = uc.motif_id);
  delete from user_competences where user_id = dup;

  -- 2c) Filet : colonnes user connues sans FK formelle éventuelle.
  update mission_logs set actor_id = keep where actor_id = dup;

  -- 3) Rattache l'identité Microsoft du doublon au canonique (multi-identité),
  --    puis nettoie ses autres liens.
  update user_auth_providers set user_id = keep where user_id = dup and provider = 'azure-ad';
  delete from user_auth_providers where user_id = dup;

  -- 4) Neutralise le doublon (on ne le supprime pas → aucun risque de référence résiduelle).
  update users set active = false, name = 'Momo - VD (fusionné → Bureau)' where id = dup;
end $$;

notify pgrst, 'reload schema';
