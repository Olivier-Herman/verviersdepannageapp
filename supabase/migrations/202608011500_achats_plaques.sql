-- Module Gestion Achat : plaques extraites des factures (attribution des coûts
-- aux dépanneuses/véhicules maison). plaques = [{plaque, montant}] repéré par
-- l'IA sur le document (carburant, garage, pneus, entretien…).

alter table public.achats_factures
  add column if not exists plaques jsonb;

notify pgrst, 'reload schema';
