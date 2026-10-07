# Contrôle de double facturation à la validation d'une facture client (Olivier 07/10/2026).
# Avertit si une facture validée, non créditée, existe déjà pour le même dossier (référence),
# quel que soit le client, avec un montant à 10 % près ou le même véhicule à la même date
# d'intervention. On ne bloque jamais une vraie deuxième mission : cocher « Autre mission
# (doublon vérifié) » avec un motif laisse passer, et le motif est noté dans l'historique.
# Hors contrôle : Parquet, frais de justice, Circuit, avance refacturée, compte de VD Soft.
norm = lambda s: ''.join([ch for ch in (s or '').upper() if ch.isalnum()])
EXCL = ['PARQUET', 'FRAIS DE JUSTICE', 'CIRCUIT', 'SPA FRAN']
def_date = lambda mv: ([l.name.split('Intervention du ')[1][:10] for l in mv.invoice_line_ids if l.name and 'Intervention du ' in l.name] or [''])[0]
for rec in records:
    if rec.move_type != 'out_invoice' or rec.company_id.id != 1:
        continue
    if rec.x_doublon_verifie:
        if not (rec.x_doublon_motif or '').strip():
            raise UserError("Indique le motif de la deuxième facture (champ « Motif de la deuxième facture »), puis valide à nouveau.")
        rec.message_post(body="Deuxième facture sur ce dossier, vérifiée à la validation : " + rec.x_doublon_motif)
        continue
    k = norm(rec.ref)
    if len(k) < 6 or (k[:1] == 'S' and k[1:].isdigit()) or 'CIRCUIT' in k or (rec.invoice_origin or '').startswith('BILL/'):
        continue
    pname = (rec.commercial_partner_id.name or '').upper()
    if [e for e in EXCL if e in pname]:
        continue
    core = (rec.ref or '').strip()[:24]
    cands = env['account.move'].search([('move_type', '=', 'out_invoice'), ('state', '=', 'posted'), ('company_id', '=', 1), ('id', '!=', rec.id), ('ref', 'ilike', core)], limit=50)
    hits = []
    d0 = def_date(rec)
    for c in cands:
        if norm(c.ref) != k or c.payment_state == 'reversed' or c.reversal_move_ids.filtered(lambda r: r.state == 'posted'):
            continue
        if [e for e in EXCL if e in (c.commercial_partner_id.name or '').upper()]:
            continue
        big = max(abs(c.amount_total), abs(rec.amount_total)) or 1
        same_amount = abs(c.amount_total - rec.amount_total) <= 0.1 * big
        same_vehicle_day = bool(rec.x_studio_plaque_1 and c.x_studio_plaque_1 and rec.x_studio_plaque_1.id == c.x_studio_plaque_1.id and d0 and d0 == def_date(c))
        if same_amount or same_vehicle_day:
            hits.append(c)
    if hits:
        if env.user.login == 'administration@verviersdepannage.com':
            rec.message_post(body="⚠️ Une facture existe déjà pour ce dossier : " + ', '.join([h.name for h in hits[:3]]) + ". À vérifier (double facturation possible).")
            continue
        detail = ', '.join(['%s (%.2f €, %s)' % (h.name, h.amount_total, h.commercial_partner_id.name) for h in hits[:3]])
        raise UserError("Une facture existe déjà pour le dossier %s : %s.\n\nEst-ce une deuxième mission réelle ?\n• Oui : coche « Autre mission (doublon vérifié) », indique le motif, puis valide à nouveau.\n• Non : menu Action › « C'est un doublon »." % (rec.ref, detail))
