-- Menu v3 : Jona pilote du menu navigable (Olivier 09/09/2026 : « met Jona en pilote »).
update feature_flags
   set pilot_user_ids = (select array_agg(distinct x) from unnest(coalesce(pilot_user_ids, '{}'::uuid[]) || array['eda29707-c9c7-47b5-ab21-084ea22201bc'::uuid]) as x),
       updated_at = now()
 where key = 'nav_menu_v2';
INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Jona pilote du menu v3 (flag nav_menu_v2). Lot 2 (palette ⌘K) lancé.' FROM chantiers WHERE key = 'nav';
