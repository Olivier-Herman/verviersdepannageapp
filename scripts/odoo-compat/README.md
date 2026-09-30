# Compatibilité VD Soft ↔ Odoo

But : savoir **avant** une montée de version Odoo (ex. 19 → 20) ce que VD Soft utilise et qui aurait disparu ou changé.

## 1. Mettre à jour l'inventaire (après toute modification du code qui parle à Odoo)
```
npx tsx --tsconfig tsconfig.json scripts/odoo-compat/inventory.ts
```
→ `inventory.json` : chaque modèle, méthode et champ utilisé, avec les fichiers.

## 2. Contrôler une base
Base actuelle (doit être verte, référence) :
```
npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/odoo-compat/check.ts
```
Copie de test de la nouvelle version (demandée sur odoo.com → Mes bases de données → « Tester la mise à jour ») :
```
ODOO_CHECK_URL=https://<copie>.odoo.com ODOO_CHECK_DB=<copie> \
  npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/odoo-compat/check.ts
```
(`ODOO_CHECK_UID` / `ODOO_CHECK_KEY` si l'utilisateur ou la clé API diffèrent sur la copie.)

→ `rapport-<version>-<date>.md` : champs ou modèles absents, relations cassées, méthodes à essayer à la main, appels dynamiques à relire.

## 3. Procédure de migration
1. Demander la copie de test à Odoo, lancer le contrôle dessus.
2. Corriger le code pour chaque problème (sur la copie), relancer jusqu'au vert.
3. Essayer à la main les méthodes listées (valider une facture, lettrer, envoyer, créer un client…).
4. Seulement alors, migrer la vraie base, et relancer le contrôle juste après.

`known.json` : exceptions acceptées (champ absent dans du code mort ou ponctuel), listées à part.

Référence : base actuelle en Odoo 19.0 — contrôle vert le 30/09/2026 (2 exceptions connues). Corrigés ce jour-là grâce au contrôle : `account.payment.ref` → `memo` (paiements sur le détail facture) et `fleet.vehicle.log.contract.cost_amount` → `amount` (contrats sur la fiche véhicule), deux écrans vides en silence depuis Odoo 19.
