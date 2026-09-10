-- Nouveau chantier : module « Dossier de destruction » (Olivier 10/09/2026), lot 1 livré.
INSERT INTO chantiers (key, title, tag, status, note, updated_at, updated_by) VALUES
  ('destruction', 'Dossiers de destruction', 'fourrière', 'cours',
   'Lot 1 livré le 10/09 : capture au téléphone (scan QR de l''étiquette ou choix dans le parc, ou véhicule sans fiche), photos en rafale, lecture Claude (VIN, marque, modèle, couleur, état — pas de km), dossier DEST-AAAA-NNNN, sortie du parc motif destruction sans frais et sans facture, verrou de sortie respecté (motif + PIN sinon). Consultation : recherche par VIN partiel / marque / modèle / couleur / période, photos, frais À LA DATE DE PRÉSENTATION, trace des présentations, document imprimable. Épaviste = réglage métier (Car Parts & Recycling). Aucun envoi à la commune. À faire : retour terrain sur les premières sorties ; QR Informex si un jour la casse en émet ; lien depuis la Sortie AVP.', now(), 'Claude')
ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, tag = EXCLUDED.tag, updated_at = now(), updated_by = 'Claude';
INSERT INTO chantier_logs (chantier_id, actor, text)
SELECT id, 'Claude', 'Lot 1 livré : capture téléphone + lecture photos + dossier + sortie du parc + consultation avec frais à la date de présentation + document imprimable.' FROM chantiers WHERE key = 'destruction';
