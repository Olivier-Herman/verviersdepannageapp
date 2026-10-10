-- VD Assistance (Olivier 10/10/2026) : le chauffeur envoie la demande de paiement dans l'app du client ; le client paie
-- sur la page SumUp (Bancontact, carte, Apple Pay). Paiement vérifié chez SumUp puis enregistré par l'assistant
-- d'encaissement habituel du chauffeur.
-- client_paiement = { checkout_id, url, montant, reference, demande_le }
alter table incoming_missions add column if not exists client_paiement jsonb;

notify pgrst, 'reload schema';
