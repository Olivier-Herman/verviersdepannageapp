-- VD Assistance (Olivier 10/10/2026) : Dynamic Island / écran verrouillé du client en panne. Jeton APNs de la Live
-- Activity démarrée par l'app iPhone à l'envoi de la demande ; le serveur la met à jour à chaque étape.
alter table incoming_missions add column if not exists client_la_token text;

notify pgrst, 'reload schema';
