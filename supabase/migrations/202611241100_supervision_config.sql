-- Suivi du travail du bureau : rapports à Mobi chaque soir à 21 h, le samedi et le 1er du mois (Olivier 24/11/2026).
-- Cf src/lib/supervision/index.ts et /api/cron/supervision. Réglage unique, volontairement absent de l'écran des
-- réglages métier (rien de visible dans les outils). Jona suivi à partir du 24/11 13 h (après la réunion de la
-- direction), Momo à partir du 24/11 (à sa demande). Momo : ses deux comptes VD Soft.
insert into app_settings (key, value, updated_at) values
  ('supervision_config', '{
    "destinataires": ["mobi@verviersdepannage.be"],
    "boites": ["info@verviersdepannage.com", "administration@verviersdepannage.com", "fourriere@verviersdepannage.be"],
    "boites_a_traiter": ["administration@verviersdepannage.com", "fourriere@verviersdepannage.be"],
    "personnes": [
      {"nom": "Jona", "user_ids": ["eda29707-c9c7-47b5-ab21-084ea22201bc"], "odoo_uids": [7], "signatures": ["Jona"], "depuis": "2026-11-24T12:00:00.000Z"},
      {"nom": "Momo", "user_ids": ["e7cbab7f-1d0a-4109-ab60-7b223d088b57", "1b628f46-44ef-4a89-bdd7-a648e03f2154"], "odoo_uids": [5], "signatures": ["Momo"], "depuis": "2026-11-23T23:00:00.000Z"}
    ],
    "mobi_signatures": ["Mobi"],
    "poids": {"facturation": 3, "fourriere": 3, "parc": 1, "dispatch": 2, "fiches": 1, "mail": 2, "erp_piece": 3, "erp_facture": 0, "erp_paiement": 2, "erp_lettrage": 1},
    "seuil_jours": 7,
    "app_url": "https://app.verviersdepannage.com"
  }', now())
on conflict (key) do nothing;

notify pgrst, 'reload schema';
