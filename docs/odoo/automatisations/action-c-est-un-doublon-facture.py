# Action « C'est un doublon » sur une facture client en brouillon (Olivier 07/10/2026).
norm = lambda s: ''.join([ch for ch in (s or '').upper() if ch.isalnum()])
for mv in records:
    if mv.move_type != 'out_invoice' or mv.state != 'draft':
        raise UserError("Seule une facture client en brouillon peut être annulée comme doublon.")
    k = norm(mv.ref)
    hits = env['account.move']
    if len(k) >= 6:
        for c in env['account.move'].search([('move_type', '=', 'out_invoice'), ('state', '=', 'posted'), ('company_id', '=', mv.company_id.id), ('id', '!=', mv.id), ('ref', 'ilike', (mv.ref or '').strip()[:24])], limit=50):
            if norm(c.ref) == k and c.payment_state != 'reversed' and not c.reversal_move_ids.filtered(lambda r: r.state == 'posted'):
                hits |= c
    if not hits:
        raise UserError("Aucune facture validée pour le dossier %s : ce n'est pas un doublon, rien n'est annulé." % (mv.ref or '—'))
    h = hits.sorted('id')[0]
    mv.write({'x_doublon_de': h.name})
    mv.button_cancel()
    mv.message_post(body="Doublon de la facture %s (dossier %s) : facture brouillon annulée par %s." % (h.name, mv.ref, env.user.name))
