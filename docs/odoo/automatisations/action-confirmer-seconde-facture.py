# Bouton « Confirmer la seconde facture » (Olivier 08/10/2026) : deuxième mission réelle sur le même
# dossier. Coche « Autre mission (doublon vérifié) », écrit le motif (qui, quand) et valide la facture.
for rec in records:
    if rec.move_type != 'out_invoice' or rec.state != 'draft':
        continue
    rec.write({'x_doublon_verifie': True, 'x_doublon_motif': "Seconde facture confirmée par %s le %s" % (env.user.name, datetime.datetime.now().strftime('%d/%m/%Y %H:%M'))})
    rec.action_post()
