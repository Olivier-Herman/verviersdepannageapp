# Action « C'est un doublon » sur un bon de commande (Olivier 07/10/2026) : la facture existe déjà
# pour ce dossier → ce bon de commande est annulé, la facture existante est notée (x_doublon_de) ;
# VD Soft rattache ensuite la fiche à cette facture ou la marque « doublon ».
norm = lambda s: ''.join([ch for ch in (s or '').upper() if ch.isalnum()])
for so in records:
    if so.state == 'cancel':
        continue
    if so.state not in ('draft', 'sent'):
        raise UserError("« C'est un doublon » ne s'applique qu'à un bon de commande pas encore confirmé (ici : %s)." % so.name)
    k = norm(so.client_order_ref)
    hits = env['account.move']
    if len(k) >= 6:
        for c in env['account.move'].search([('move_type', '=', 'out_invoice'), ('state', '=', 'posted'), ('company_id', '=', so.company_id.id), ('ref', 'ilike', (so.client_order_ref or '').strip()[:24])], limit=50):
            if c not in so.invoice_ids and norm(c.ref) == k and c.payment_state != 'reversed' and not c.reversal_move_ids.filtered(lambda r: r.state == 'posted'):
                hits |= c
    if not hits:
        raise UserError("Aucune facture validée pour le dossier %s : ce n'est pas un doublon, rien n'est annulé." % (so.client_order_ref or '—'))
    h = hits.sorted('id')[0]
    so.write({'x_doublon_de': h.name})
    so._action_cancel()
    so.message_post(body="Doublon de la facture %s (dossier %s) : bon de commande annulé par %s." % (h.name, so.client_order_ref, env.user.name))
