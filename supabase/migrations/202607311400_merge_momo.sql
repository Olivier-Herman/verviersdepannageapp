-- Fusion des deux comptes Momo en un seul (multi-identité Microsoft).
-- Canonique : Momo Bureau VD  e7cbab7f-1d0a-4109-ab60-7b223d088b57 (session toujours ouverte)
-- Doublon   : Momo - VD       1b628f46-44ef-4a89-bdd7-a648e03f2154
-- Correctif : ne cible QUE public.users (Supabase a aussi auth.users), et rend
-- chaque réassignation résiliente (sur conflit d'unicité, on retire la ligne du
-- doublon). Le précédent bloc rollbackait tout. Olivier 2026-07-31.

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

  -- 2) Réassigne toutes les FK vers PUBLIC.users(id) : dup -> keep, table par table,
  --    résilient : sur conflit (ligne déjà présente pour keep), on retire celle du dup.
  for r in
    select tc.table_name as tbl, kcu.column_name as col
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema  = 'public'
      and ccu.table_schema = 'public' and ccu.table_name = 'users' and ccu.column_name = 'id'
      and tc.table_name not in ('user_auth_providers')     -- géré à part (multi-identité)
  loop
    begin
      execute format('update public.%I set %I = %L where %I = %L', r.tbl, r.col, keep, r.col, dup);
    exception when others then
      -- conflit d'unicité/PK : la ligne du doublon fait doublon avec le canonique → on la retire.
      begin
        execute format('delete from public.%I where %I = %L', r.tbl, r.col, dup);
      exception when others then null;
      end;
    end;
  end loop;

  -- 2b) Filet : colonnes user connues (au cas où pas de FK formelle).
  begin update mission_logs set actor_id = keep where actor_id = dup; exception when others then null; end;

  -- 3) Rattache l'identité Microsoft du doublon au canonique (multi-identité), puis nettoie.
  update user_auth_providers set user_id = keep where user_id = dup and provider = 'azure-ad';
  delete from user_auth_providers where user_id = dup;

  -- 4) Neutralise le doublon (pas de suppression → aucune référence résiduelle cassée).
  update users set active = false, name = 'Momo - VD (fusionné → Bureau)' where id = dup;
end $$;

notify pgrst, 'reload schema';
