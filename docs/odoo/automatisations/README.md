# Règles automatiques posées dans l'ERP par VD Soft

Copie de référence du code des automatisations créées dans l'ERP (Paramètres › Technique ›
Automatisations). La version active est celle de l'ERP ; ce dossier sert à la relire et à la
recréer à l'identique.

## Contrôle de double facturation (Olivier, 07/10/2026)

| Automatisation (ERP) | Déclencheur | Code |
|---|---|---|
| n° 6 « VD Soft — double facturation (validation facture) », action serveur 1234 | facture : état = Comptabilisé | `double-facturation-facture.py` |
| n° 7 « VD Soft — double facturation (confirmation bon de commande) », action serveur 1235 | bon de commande : état = Bon de commande | `double-facturation-bon-de-commande.py` |

Champs ajoutés (factures et bons de commande, non copiés en cas de duplicata) :
`x_doublon_verifie` « Autre mission (doublon vérifié) » et `x_doublon_motif` « Motif de la
deuxième facture ». Écrans : vues héritées 4418 (facture, sous la référence) et 4419 (bon de
commande, sous la référence client).

Règle : même dossier (référence normalisée, ≥ 6 caractères), quel que soit le client, ET montant
à 10 % près OU même véhicule à la même date d'intervention ; facture précédente validée et non
créditée. Hors contrôle : Parquet, frais de justice, Circuit, avance refacturée (origine BILL/…).
On n'interdit jamais une vraie deuxième mission : la case + un motif laissent passer (motif noté
dans l'historique). Compte de VD Soft (validation automatique) : simple avertissement dans
l'historique, jamais de blocage. Mesure sur 2026 : 36 avertissements sur 5 913 factures.
