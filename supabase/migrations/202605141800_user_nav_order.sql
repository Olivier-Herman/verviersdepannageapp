-- ============================================================
-- Ordre personnalise du menu sidebar par utilisateur
-- ============================================================
-- Chaque user peut reorganiser l'ordre des entrees du menu (drag & drop
-- dans /profil). Stocke en text[] (liste des hrefs dans l'ordre voulu).
-- NULL = ordre par defaut (defini dans src/components/layout/nav-items.ts).
--
-- filterNavItems applique cet ordre s'il est present : les hrefs presents
-- sont rendus dans l'ordre du tableau, les nouvelles entrees (ajoutees
-- apres que le user a personnalise) viennent a la fin dans leur ordre
-- d'origine.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS nav_order text[];

COMMENT ON COLUMN public.users.nav_order IS
  'Ordre personnalise du menu sidebar (drag & drop /profil). Array de hrefs (ex: [/dispatch, /facturation, /missions-terminees, ...]). NULL = ordre par defaut.';
