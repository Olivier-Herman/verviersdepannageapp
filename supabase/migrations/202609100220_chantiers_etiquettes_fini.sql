-- Étiquettes parc : terminé le 09/09/2026. Toute entrée en parc imprime via reprintLabelForMission
-- (mal garée, rodéo, AVP, saisie, relivraison) ; impressions test du 09/09 15:44 réussies sur les
-- trois sources restantes, et chaque impression laisse désormais une ligne dans le journal de la fiche.
INSERT INTO chantiers (key, title, status, note, updated_at, updated_by) VALUES
  ('etiquettes', 'Étiquettes parc', 'fini',
   'Terminé le 09/09 : mal garée, rodéo et AVP passent par le même helper que les autres sources (toute entrée en parc imprime, note propre à chaque source : blocage police, restitution J+3 avec levée, AVP +60 jours). Impressions test réussies le 09/09 à 15h44 sur AH142SL (mal garée), CP8051 (AVP) et HSAV6087 (rodéo). Chaque impression laisse une trace dans le journal de la fiche (réussie ou échouée), un PC Zebra éteint se voit donc dans la fiche.', now(), 'Claude')
ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now(), updated_by = 'Claude';
INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Clôturé : impressions test mal garée / AVP / rodéo réussies (15h44), journal d''impression ajouté sur chaque fiche.' FROM chantiers WHERE key = 'etiquettes';
