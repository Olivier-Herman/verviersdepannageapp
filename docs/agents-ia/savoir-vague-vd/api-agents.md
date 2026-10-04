# API des agents dans VD Soft — lot 1

> Pour le bureau des agents (HOOS). En production depuis le 05/10/2026.
> Modèle validé par Olivier : **l'agent prépare, une personne valide, VD Soft exécute**, avec la trace de qui a préparé et de qui a validé.

## Authentification

- En-tête `Authorization: Bearer vda_…` : **une clé par agent**.
- Mobi crée ou remplace la clé dans VD Soft (Administration › Propositions des agents › Agents et droits). Elle n'est affichée qu'une fois, puis elle est gardée hors du code.
- Clé absente, invalide ou agent désactivé : réponse 401.
- Tout appel hors des sociétés ou des types de l'agent : réponse 403 ou 400, **noté en rouge dans le journal**.

## Ce que l'agent peut faire : `GET /api/agents/moi`

Cet appel renvoie :
- les sociétés de l'agent ;
- les lectures permises ;
- les types de propositions, avec l'indication « envoi direct » ou non ;
- `nuit` : vrai de 18 h à 6 h ;
- les règles.

## Lectures : `GET /api/agents/lire?quoi=…&societe=1|2|3`

La société est **obligatoire** et vérifiée contre les droits de l'agent. Chaque lecture est notée dans le journal.

| `quoi` | Sociétés | Paramètres |
|---|---|---|
| `fiche` | 1 | `numero` (numéro de mission) ou `plaque` |
| `factures_clients` | 1, 2, 3 | `nom` (numéro ou référence), `partenaire`, `etat` (draft / posted / cancel), `impayees=1` |
| `factures_achat` | 1, 2, 3 | les mêmes paramètres |
| `banque` | 1, 2, 3 | — (lignes non rapprochées, les 100 plus récentes) |
| `etats_de_frais` | 1 | `numero` (numéro d'état de frais ou plaque), `etat` |
| `domaine` | 1 | — (dates IN et ventes d'épaves, les 50 plus récentes de chaque) |

## Propositions : `POST /api/agents/propositions`

```json
{ "type": "…", "societe": 1, "pourquoi": "ce que j'ai vérifié et pourquoi je le propose", "contenu": { … }, "certain": false }
```

| `type` | Agents | `contenu` | Exécution |
|---|---|---|---|
| `lot_paiement` | Florent | `facture_ids` : factures d'achat validées et impayées (société 1 seulement, 100 au plus) | Après validation : paiements SEPA sur le journal ING, puis **lot de paiement** dans l'ERP. Le fichier est ensuite chargé à la banque par Olivier. |
| `facture_achat` | Florent, Rémi | `facture_id` : brouillon de facture d'achat | Validation du brouillon. VD Soft refuse d'abord tout doublon (même fournisseur et même référence déjà validée). **Envoi direct pour Rémi**, le jour seulement : société 2, et soit arrivée par Peppol sous le seuil HTVA (1 000 €, réglable), soit facture entre sociétés du groupe. |
| `note_credit` | Élodie | `facture` : numéro de la facture client validée ; `motif` ; `refacturer_partner_id` (facultatif, refacture au bon client) | Note de crédit validée et, si demandée, nouvelle facture validée. **Envoi direct si `certain: true`, même la nuit** : c'est la seule exception de nuit. |
| `envoi_comptable` | Benoît | `a` : adresse du comptable ; `objet` ; `message` ; `facture_ids` : pièces de l'ERP dont le PDF est joint | Mail envoyé depuis administration@ avec mobi@ en copie. **Envoi direct le jour**, uniquement vers les adresses du comptable réglées par Olivier. |

Réponse : `{ ok, id, status }`. `status` vaut `to_validate`, ou `executed` / `failed` en cas d'envoi direct. Le champ `note` donne le résultat, ou explique pourquoi la proposition attend, par exemple « Nuit : rien ne part… ».

Un refus au dépôt renvoie une réponse 400 avec un message en clair, par exemple « Doublon : … », « Facture déjà validée » ou « Destinataire non autorisé ».

## Suivi : `GET /api/agents/propositions?statut=…`

Cet appel renvoie les 50 dernières propositions de l'agent, avec pour chacune :
- le statut ;
- qui l'a validée ;
- le **motif du refus** (`refused_reason`) ou la **correction demandée** (`correction`) ;
- le résultat ou l'erreur.

L'agent relit les refus et les corrections avant de reproposer.

Valeurs de `statut` : `to_validate`, `executed`, `refused`, `returned` (à corriger), `failed`.

## Garde-fous dans le code

- **La nuit (18 h–6 h, heure de Bruxelles), aucune exécution directe**, sauf `note_credit` avec `certain: true`. Une proposition qui aurait eu droit à l'envoi direct attend la validation du matin.
- **Validateur par agent** : Mobi par défaut pour tous. Olivier peut déléguer agent par agent, par exemple à Victor ou Damien.
- **Une seule exécution** par proposition : un double clic ne lance rien deux fois.
- **Gaëtan (DGJ VHU)** reste inactif tant que la société 3 n'est pas ouverte au compte de l'app dans l'ERP.
