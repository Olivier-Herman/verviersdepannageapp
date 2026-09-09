-- Mal garée camionnette : 206,61 € HTVA (250 € TVAC) vivait uniquement dans la page
-- publique (site/_data.ts). Ligne de tarif propre à la classe « van » : le moteur
-- préfère la ligne de classe quand elle existe, la générique (165,29) reste pour les voitures.
INSERT INTO source_tariff_lines (source, mission_type, position, kind, name, default_qty, default_price, apply_surcharges, effective_from, notes, vehicle_class)
SELECT 'police_mg', 'remorquage', 1, 'SERV-PEC', 'Forfait enlèvement Mal Garée camionnette (PECMG)', 1, 206.61, false, '2026-05-25', 'Code Odoo: PECMG. = 250 EUR TVAC. Classe camionnette.', 'van'
WHERE NOT EXISTS (SELECT 1 FROM source_tariff_lines WHERE source = 'police_mg' AND kind = 'SERV-PEC' AND vehicle_class = 'van');
