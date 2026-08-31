-- Permission « Dupliquer une fiche ».
--
-- Olivier 2026-08-31 : « il faut que Jonathan ait accès au bouton dupliquer une
-- fiche ». Le bouton était réservé au superadmin. Plutôt que de coder un nom en
-- dur, ou d'ouvrir la duplication aux cinq dispatchers d'un coup, on en fait une
-- permission nommée : elle s'attribue et se retire dans /admin/users, personne
-- par personne, sans repasser par le code.
--
-- Le superadmin garde l'accès sans avoir besoin du module.

INSERT INTO modules (id, label, description, icon, sort_order, active)
VALUES (
  'duplicate_mission',
  'Dupliquer une fiche',
  'Autorise le bouton « Dupliquer la mission » sur une fiche : crée une nouvelle fiche au contenu identique, cycle de vie remis à zéro',
  '🧬',
  72,
  true
)
ON CONFLICT (id) DO UPDATE
  SET label       = EXCLUDED.label,
      description = EXCLUDED.description,
      icon        = EXCLUDED.icon,
      active      = true;

-- Attribution immédiate à Jona (dispatcher), à sa demande — pour qu'il n'ait pas
-- à attendre un passage dans l'écran d'administration.
INSERT INTO user_modules (user_id, module_id, granted)
SELECT id, 'duplicate_mission', true
FROM users
WHERE email = 'jonathan@verviersdepannage.be'
ON CONFLICT (user_id, module_id) DO UPDATE SET granted = true;

NOTIFY pgrst, 'reload schema';
