-- Réglages métier : les valeurs de repli deviennent des LIGNES en base (Olivier 09/09/2026 :
-- « les réglages du lot A sont OK, retire le repli »). app_settings.value = texte JSON.
INSERT INTO app_settings (key, value, updated_at) VALUES ('odoo_partner_frais_justice', '67', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('odoo_partner_police_federale', '79', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('odoo_journal_achats', '8', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('odoo_partner_spf_finances', '83', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('odoo_journal_ventes_domaine', '7', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('odoo_product_forfait', '5', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('odoo_tax_21', '5', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('odoo_partner_anwb', '56', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('odoo_partner_sumup', '1221', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('odoo_partner_touring', '14', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('odoo_journal_paie', '45', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('mail_parquet', '"fdj.pplge@just.fgov.be"', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('mail_frais_justice', '"frais.justice.verviers@just.fgov.be"', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('mail_domaine_agent', '"rosemarie.lehnen@minfin.fed.be"', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('mail_ima_avis_paiement', '"dfc@imabenelux.com"', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('mail_awp_avis_paiement', '"accountancy.be@allianz.com"', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('mail_awp_rejets', '["providers.invoices.be@allianz.com", "claims.be@allianz.com", "automotive.be@allianz.com", "suppliers.be@allianz.com"]', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('mail_ima_rejets', '["facturation.prestataires@ima.eu", "hub@imabenelux.com"]', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('touring_check_cc', '["Andre.ANGELIQUE@touring.be"]', now()) ON CONFLICT (key) DO NOTHING;
INSERT INTO app_settings (key, value, updated_at) VALUES ('forfait_parc_accident_tvac', '220', now()) ON CONFLICT (key) DO NOTHING;
