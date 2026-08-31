-- Agent Mail : le module reste EN BASE mais DÉSACTIVÉ.
--
-- Olivier 2026-08-31 : l'écran passe en superadmin uniquement le temps du
-- rodage (même traitement que Relivraison, Réception, Gestion Achat). Laisser
-- le module actif dans /admin/users laisserait croire qu'on peut l'attribuer à
-- quelqu'un, alors que la nav et les API filtrent sur le rôle.
--
-- Pour l'ouvrir à Jona / Momo plus tard : remettre active = true ici, et
-- repasser l'entrée de nav-items.ts sur moduleId 'mail_agent'.

UPDATE modules SET active = false WHERE id = 'mail_agent';

NOTIFY pgrst, 'reload schema';
