# Champ calculé x_doublon_alerte (facture client) — Olivier 08/10/2026 (2ENJ663) : l'avertissement
# de double facturation s'affiche EN HAUT de la facture brouillon, avec deux boutons :
# « Confirmer la seconde facture » et « C'est un doublon, ne pas créer ». Même règle que le contrôle
# à la validation : même dossier (référence), montant à 10 % près, hors découpe VD Soft par groupe.
norm = lambda s: ''.join([ch for ch in (s or '').upper() if ch.isalnum()])
EXCL = ['PARQUET', 'FRAIS DE JUSTICE', 'CIRCUIT', 'SPA FRAN']
grp = lambda mv: (mv.invoice_origin or '').strip().split(' ')
same_mission_other_group = lambda a, b: len(grp(a)) == 2 and len(grp(b)) == 2 and grp(a)[0].isdigit() and grp(a)[0] == grp(b)[0] and len(grp(a)[1]) == 1 and len(grp(b)[1]) == 1 and grp(a)[1] != grp(b)[1]
for rec in self:
    msg = False
    k = norm(rec.ref)
    if rec.move_type == 'out_invoice' and rec.state == 'draft' and rec.company_id.id == 1 and not rec.x_doublon_verifie \
            and len(k) >= 6 and not (k[:1] == 'S' and k[1:].isdigit()) and 'CIRCUIT' not in k \
            and not (rec.invoice_origin or '').startswith('BILL/') \
            and not [e for e in EXCL if e in (rec.commercial_partner_id.name or '').upper()]:
        hits = []
        for c in self.env['account.move'].search([('move_type', '=', 'out_invoice'), ('state', '=', 'posted'), ('company_id', '=', 1), ('ref', 'ilike', (rec.ref or '').strip()[:24])], limit=50):
            if c.id == rec.id or norm(c.ref) != k or c.payment_state == 'reversed' or c.reversal_move_ids.filtered(lambda r: r.state == 'posted'):
                continue
            if [e for e in EXCL if e in (c.commercial_partner_id.name or '').upper()] or same_mission_other_group(rec, c):
                continue
            big = max(abs(c.amount_total), abs(rec.amount_total)) or 1
            if abs(c.amount_total - rec.amount_total) <= 0.1 * big:
                hits.append('%s (%.2f €, %s)' % (c.name, c.amount_total, c.commercial_partner_id.name))
        if hits:
            msg = "⚠️ Une facture existe déjà pour le dossier %s : %s. Est-ce une deuxième mission réelle ?" % (rec.ref, ', '.join(hits[:3]))
    rec['x_doublon_alerte'] = msg
