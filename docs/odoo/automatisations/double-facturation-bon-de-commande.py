# Contrôle de double facturation à la confirmation d'un bon de commande (Olivier 07/10/2026) :
# le doublon s'arrête avant même que la facture existe. Même règle que pour les factures.
norm = lambda s: ''.join([ch for ch in (s or '').upper() if ch.isalnum()])
EXCL = ['PARQUET', 'FRAIS DE JUSTICE', 'CIRCUIT', 'SPA FRAN']
for so in records:
    if so.company_id.id != 1:
        continue
    if so.x_doublon_verifie:
        if not (so.x_doublon_motif or '').strip():
            raise UserError("Indique le motif de la deuxième facturation (champ « Motif de la deuxième facture »), puis confirme à nouveau.")
        so.message_post(body="Deuxième facturation sur ce dossier, vérifiée à la confirmation : " + so.x_doublon_motif)
        continue
    k = norm(so.client_order_ref)
    if len(k) < 6 or 'CIRCUIT' in k or [e for e in EXCL if e in (so.partner_id.commercial_partner_id.name or '').upper()]:
        continue
    core = (so.client_order_ref or '').strip()[:24]
    big = lambda a, b: max(abs(a), abs(b)) or 1
    hits = []
    for c in env['account.move'].search([('move_type', '=', 'out_invoice'), ('state', '=', 'posted'), ('company_id', '=', 1), ('ref', 'ilike', core)], limit=50):
        if norm(c.ref) == k and c.payment_state != 'reversed' and not c.reversal_move_ids.filtered(lambda r: r.state == 'posted') and not [e for e in EXCL if e in (c.commercial_partner_id.name or '').upper()] and abs(c.amount_total - so.amount_total) <= 0.1 * big(c.amount_total, so.amount_total):
            hits.append('%s (%.2f €, %s)' % (c.name, c.amount_total, c.commercial_partner_id.name))
    for o in env['sale.order'].search([('state', '=', 'sale'), ('company_id', '=', 1), ('id', '!=', so.id), ('client_order_ref', 'ilike', core)], limit=50):
        if norm(o.client_order_ref) == k and abs(o.amount_total - so.amount_total) <= 0.1 * big(o.amount_total, so.amount_total):
            hits.append('bon de commande %s (%.2f €, %s)' % (o.name, o.amount_total, o.partner_id.name))
    if hits:
        if env.user.login == 'administration@verviersdepannage.com':
            so.message_post(body="⚠️ Ce dossier est déjà facturé ou commandé : " + ', '.join(hits[:3]) + ". À vérifier (double facturation possible).")
            continue
        raise UserError("Ce dossier %s est déjà facturé : %s.\n\nEst-ce une deuxième mission réelle ?\n• Oui : coche « Autre mission (doublon vérifié) », indique le motif, puis confirme à nouveau.\n• Non : ne confirme pas ce bon de commande (doublon)." % (so.client_order_ref, ', '.join(hits[:3])))
