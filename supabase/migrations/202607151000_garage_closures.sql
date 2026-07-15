-- Module « Fermetures de garage » : alertes temporaires affichées sur les fiches
-- (dispatch + chauffeur) quand l'adresse de destination/relivraison correspond à
-- un garage fermé sur une période. Gérable depuis /admin/garage-closures.
-- Olivier 2026-07-15.
CREATE TABLE IF NOT EXISTS garage_closures (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text,                       -- libellé (ex : Car Avenue Verviers)
  match_keywords text NOT NULL,              -- mots-clés séparés par virgule, TOUS requis dans l'adresse
  date_from      date NOT NULL,              -- inclus
  date_to        date NOT NULL,              -- inclus
  message        text NOT NULL,              -- message affiché
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

ALTER TABLE garage_closures DISABLE ROW LEVEL SECURITY;
GRANT ALL ON garage_closures TO anon, authenticated, service_role;

-- Seed : le cas Car Avenue Verviers déjà demandé (18/07 → 02/08/2026).
INSERT INTO garage_closures (name, match_keywords, date_from, date_to, message, active)
SELECT 'Car Avenue Verviers (Mercedes)', 'car avenue, verviers', '2026-07-18', '2026-08-02',
       'Garage fermé du 18/07/2026 au 02/08/2026 inclus, dépannage et remorquage repris par Car Avenue Eupen', true
WHERE NOT EXISTS (SELECT 1 FROM garage_closures WHERE match_keywords = 'car avenue, verviers' AND date_from = '2026-07-18');

NOTIFY pgrst, 'reload schema';
