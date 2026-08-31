-- Module « Agent Mail » dans le catalogue des permissions.
--
-- Olivier 2026-08-31 : l'écran doit être attribuable dans /admin/users comme
-- n'importe quel autre module, et pas réservé au rôle admin. Ça permet de
-- l'ouvrir à Jona / Momo (qui traitent la boîte) sans leur donner l'admin.
--
-- Le module donne accès à la LECTURE de la file et au déclenchement d'une
-- analyse (lecture seule). L'APPLICATION (note de crédit + refacturation dans
-- Odoo) reste réservée à admin/superadmin : c'est une écriture comptable.

INSERT INTO modules (id, label, description, icon, sort_order, active)
VALUES (
  'mail_agent',
  'Agent Mail',
  'Traitement assisté des mails administratifs : rejets de facture, rapprochement Odoo, préparation des notes de crédit',
  '📬',
  71,
  true
)
ON CONFLICT (id) DO UPDATE
  SET label       = EXCLUDED.label,
      description = EXCLUDED.description,
      icon        = EXCLUDED.icon,
      active      = true;

NOTIFY pgrst, 'reload schema';
