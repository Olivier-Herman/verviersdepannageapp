-- Restitution : payeur choisi par groupe du dossier (Olivier 29/09/2026 :
-- « le 1er REM est facturé à l'assistance et le gardiennage au transporteur »).
-- { "<mission_id>": { "kind": "client" | "dossier" | "third", "partner_id": 123, "name": "…" } }
alter table public.restitutions add column if not exists leg_payers jsonb;
-- Factures créées pour d'autres payeurs que le client présent : [{ odoo_id, url, client_id, client_name, total_htva }]
alter table public.restitutions add column if not exists third_invoices jsonb;

notify pgrst, 'reload schema';
