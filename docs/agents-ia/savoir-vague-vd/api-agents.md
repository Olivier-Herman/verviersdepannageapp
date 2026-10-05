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
| `envoi_comptable` | Benoît | `a` : adresse du comptable ; `objet` ; `message` (tutoiement) ; `facture_ids` : pièces de l'ERP dont le PDF est joint | Mail envoyé **depuis la boîte de Mobi** (jamais administration@), signé « Benoît — Assistant IA de Mobi ». **Envoi direct le jour**, uniquement vers les adresses du comptable réglées par Olivier **et** du domaine du cabinet. |

| `question_olivier` | Florent | `sujet: "facture_nom_prive"`, `facture_id` (facture d'achat), `destinataire` (nom et adresse lus sur la pièce) | Pas d'exécution : VD Soft envoie la question sur le Telegram d'Olivier (validateur désigné de l'agent, sinon les superadmins reliés) avec « Encoder chez VD » / « Privé, ne pas encoder », et l'affiche dans l'écran. **Une seule question par facture.** La réponse revient dans `GET /api/agents/propositions` : `status: "answered"`, `result.choix` (`encoder` ou `prive`), `validated_by`, `validated_at`. « Privé » ne supprime rien : la suite reste la décision d'Olivier. |
| `rapprochement_bouton` | Florent | `source` : `paynovate`, `sumup` ou `assureur` ; `id` : n° du versement Paynovate / SumUp, ou **ligne de banque** du virement de l'assureur. Le paiement doit être « prêt » dans Finance › Réconciliation. | Exactement le bouton « Rapprocher » (OD, lettrage, trace). **Fait seul, le jour** (Olivier 05/10/2026). Refus : versement introuvable, déjà rapproché, « à trancher » ou pas prêt. Société 1 seulement. |
| `rapprochement_banque` | Florent | `ligne_id` : ligne de banque non rapprochée ; `parts` : liste, montants **au signe de la ligne** (négatif = sortie), somme = la ligne. Une part : `{ "facture_id": 123, "montant"?: x }` (reste dû entier si pas de montant, sinon partiel) ; `{ "ecriture_ligne_id": 456, "montant"?: x }` (acompte, paiement en suspens, avance…) ; `{ "compte": "610000", "montant": x, "libelle": "…", "partenaire_id"?: n, "tva21"?: true }` (montant TVAC si `tva21`). | La ligne d'attente est remplacée par les parts, l'écriture revalidée, chaque part lettrée. **Validée par Olivier au début** ; il l'activera en direct ensuite. Refus : ligne déjà rapprochée, pièce soldée ou d'une autre société, montant supérieur au reste dû, somme ≠ ligne, compte inconnu, deux parts au même libellé. |

Exemple `rapprochement_banque` (loyer 350 € TVAC) :
```json
{ "type": "rapprochement_banque", "societe": 1, "pourquoi": "Ordre permanent « LOYER » Higny, comme chaque mois",
  "contenu": { "ligne_id": 11494, "parts": [ { "compte": "610000", "montant": -350, "libelle": "Loyer 10/2026", "partenaire_id": 402, "tva21": true } ] } }
```
Exemple (une facture soldée et une partielle) : `"parts": [ { "facture_id": 5013 }, { "facture_id": 5008, "montant": -1765 } ]`.

**Import Scrada du matin (sans agent)** : chaque jour à 6 h (Bruxelles), les relevés CODA de Scrada reçus dans info@ sont importés dans le journal « Scrada » ; l'ERP rapproche ce qu'il reconnaît. Un relevé dont le solde de départ ne suit pas le précédent arrête l'import. Résultat dans le journal de l'écran Agents IA (au nom de Florent : « import Scrada »), à lire en début de tournée.

Réponse : `{ ok, id, status }`. `status` vaut `to_validate`, ou `executed` / `failed` en cas d'envoi direct. Le champ `note` donne le résultat, ou explique pourquoi la proposition attend, par exemple « Nuit : rien ne part… ».

Un refus au dépôt renvoie une réponse 400 avec un message en clair, par exemple « Doublon : … », « Facture déjà validée » ou « Destinataire non autorisé ».

## Boîte des échanges avec le comptable : `GET /api/agents/lire?quoi=boite_comptable`

**Benoît seulement** (tout autre agent : refus journalisé). Renvoie les mails du dossier « Comptable THG » de la boîte de Mobi et les mails envoyés **uniquement** au cabinet (tous les destinataires du domaine du cabinet). Rien d'autre de la boîte n'est lu. Chaque lecture est journalisée.

## Suivi : `GET /api/agents/propositions?statut=…`

Cet appel renvoie les 50 dernières propositions de l'agent, avec pour chacune :
- le statut ;
- qui l'a validée ;
- le **motif du refus** (`refused_reason`) ou la **correction demandée** (`correction`) ;
- le résultat ou l'erreur.

L'agent relit les refus et les corrections avant de reproposer.

Valeurs de `statut` : `to_validate`, `executed`, `refused`, `returned` (à corriger), `failed`, `answered` (question répondue).

## Garde-fous dans le code

- **La nuit (18 h–6 h, heure de Bruxelles), aucune exécution directe**, sauf `note_credit` avec `certain: true`. Une proposition qui aurait eu droit à l'envoi direct attend la validation du matin.
- **Validateur par agent** : Mobi par défaut pour tous. Olivier peut déléguer agent par agent, par exemple à Victor ou Damien.
- **Une seule exécution** par proposition : un double clic ne lance rien deux fois.
- **Gaëtan (DGJ VHU)** reste inactif tant que la société 3 n'est pas ouverte au compte de l'app dans l'ERP.
