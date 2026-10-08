# Champ calculé x_doublon_alerte (bon de commande) — Olivier 08/10/2026 : même avertissement que
# sur la facture, affiché en haut du bon de commande non confirmé, avec les deux boutons.
norm = lambda s: ''.join([ch for ch in (s or '').upper() if ch.isalnum()])
EXCL = ['PARQUET', 'FRAIS DE JUSTICE', 'CIRCUIT', 'SPA FRAN']
for so in self:
    msg = False
    k = norm(so.client_order_ref)
    if so.state in ('draft', 'sent') and so.company_id.id == 1 and not so.x_doublon_verifie and len(k) >= 6 and 'CIRCUIT' not in k \
            and not [e for e in EXCL if e in (so.partner_id.commercial_partner_id.name or '').upper()]:
        core = (so.client_order_ref or '').strip()[:24]
        big = lambda a, b: max(abs(a), abs(b)) or 1
        hits = []
        for c in self.env['account.move'].search([('move_type', '=', 'out_invoice'), ('state', '=', 'posted'), ('company_id', '=', 1), ('ref', 'ilike', core)], limit=50):
            if norm(c.ref) == k and c.payment_state != 'reversed' and not c.reversal_move_ids.filtered(lambda r: r.state == 'posted') and not [e for e in EXCL if e in (c.commercial_partner_id.name or '').upper()] and abs(c.amount_total - so.amount_total) <= 0.1 * big(c.amount_total, so.amount_total):
                hits.append('%s (%.2f €, %s)' % (c.name, c.amount_total, c.commercial_partner_id.name))
        for o in self.env['sale.order'].search([('state', '=', 'sale'), ('company_id', '=', 1), ('client_order_ref', 'ilike', core)], limit=50):
            if o.id != so.id and norm(o.client_order_ref) == k and abs(o.amount_total - so.amount_total) <= 0.1 * big(o.amount_total, so.amount_total):
                hits.append('bon de commande %s (%.2f €, %s)' % (o.name, o.amount_total, o.partner_id.name))
        if hits:
            msg = "⚠️ Ce dossier %s est déjà facturé : %s. Est-ce une deuxième mission réelle ?" % (so.client_order_ref, ', '.join(hits[:3]))
    so['x_doublon_alerte'] = msg
