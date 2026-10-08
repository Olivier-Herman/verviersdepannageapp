# Bouton « Confirmer la seconde facture » sur le bon de commande (Olivier 08/10/2026) : deuxième
# mission réelle. Coche « Autre mission (doublon vérifié) », écrit le motif (qui, quand), confirme.
for so in records:
    if so.state not in ('draft', 'sent'):
        continue
    so.write({'x_doublon_verifie': True, 'x_doublon_motif': "Seconde facturation confirmée par %s le %s" % (env.user.name, datetime.datetime.now().strftime('%d/%m/%Y %H:%M'))})
    so.action_confirm()
