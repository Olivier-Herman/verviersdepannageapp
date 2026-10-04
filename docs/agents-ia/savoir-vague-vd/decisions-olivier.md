# Décisions d'Olivier — vague VD

> Réponses d'Olivier (Mobi) aux questions « à confirmer » des documents de ce dossier.
> Reçues le 04/10/2026 au soir, via la page de questions du bureau des agents.
> **Elles priment sur tout ce qui est marqué « à confirmer » ailleurs.**
> Restent ouvertes : A1 (comptes agents et file de propositions), C à F.

## A. Accès et fonctionnement

| Réf. | Décision | Ce que ça change pour les agents |
|---|---|---|
| A2 | On garde le compte ERP actuel de l'app (« VD App ») et ses accès. Tous les agents passent par l'API de VD Soft, sans utilisateur ERP par agent. | Les droits des agents viennent de VD Soft, pas de l'ERP. Ce compte **ne lit pas la société 3** (DGJ VHU) : constaté le 04/10/2026, refus d'accès de l'ERP. **Olivier doit l'ouvrir à la société 3** pour que Gaëtan puisse travailler. Dans VD Soft, chaque appel doit viser explicitement sa société (`odooRpcCompany`) : l'appel par défaut verrouille la société 1. |
| A3 | Les factures d'exception sont préparées **en brouillon, jamais envoyées**. Elles sont d'abord validées à la main ; plus tard viendront la validation automatique et l'envoi. | Un agent ne valide ni n'envoie une facture d'exception. Il prépare le brouillon complet et le signale. |
| A4 | L'agent mail n'est **pas** suspendu la nuit. | Le tri des mails continue de 18 h à 6 h. La règle « la nuit rien ne part » vaut pour les agents de nuit ; l'agent mail garde son fonctionnement actuel. |
| A5 | Victor et Damien voient le contenu des mails. | Les chefs d'équipe peuvent lire les mails eux-mêmes pour arbitrer. |
| A6 | Olivier valide les propositions de Rémi, Justine et Gaëtan. | Riga et DGJ : rien ne part sans le « oui » d'Olivier (pas de Victor ni de Damien). |
| A8 | Les mêmes agents font le service comptable de VD **et** de Riga. Des factures VD sont payées depuis le compte Riga, et inversement. | L'agent doit **détecter** un paiement fait par la mauvaise société, le **signaler au comptable**, puis préparer soit les opérations diverses (OD) des deux côtés, soit un remboursement entre sociétés. |
| A9 | Pas de marque de société sur les fiches de VD Soft. | Une fiche de mission est toujours de la société 1. |
| A10 | Pas d'inventaire des transferts Riga depuis le 27/09. | Rien à reprendre sur le passé. |

## B. Achats, paiements, banque

| Réf. | Décision | Ce que ça change pour les agents |
|---|---|---|
| B1 | Florent valide les factures d'achat via le compte de l'app et l'API. **Exception** : les avances de fonds, arrivées par mail, Peppol ou scan, doivent être refacturées : leur validation reste **manuelle, par Olivier**. | Avant de valider, Florent vérifie si la facture est une avance de fonds (liée à un dossier à refacturer). Si oui, il la laisse en brouillon et la signale à Olivier. |
| B2 | C'est Olivier qui scanne le courrier et envoie les PDF dans l'alias d'achats de chaque société. | Les factures papier arrivent dans l'ERP comme celles du mail : en brouillon, par l'alias de la société. |
| B3 | Les brouillons Peppol de **Riga** sont validés par l'agent jusqu'à **1 000 € HTVA**. **Sans limite** pour les factures entre sociétés du groupe (VD, Riga, DGJ). | Au-delà de 1 000 € HTVA, sauf facture intra-groupe, Rémi prépare et Olivier valide (A6). |
| B4 | Factures échues de personnes physiques : « ça dépend ». | Pas de règle générale. Agnès propose au cas par cas, Olivier ou Momo décident. |
| B5 | Le journal « Scrada » est le **livre de caisse**. | — |
| B6 | Le fichier de paiement, c'est la fonction **lot de paiement** de l'ERP. | Florent prépare un lot de paiement ; il ne fabrique pas de fichier à part. |
| B7 | Olivier charge le fichier dans la banque ING **en fin de journée**. Il voudrait le faire plus souvent. | Le lot doit être prêt avant la fin de journée. Plusieurs lots par jour sont souhaités. |
| B8 | Belfius et BNP servent, mais les paiements fournisseurs partent **toujours d'ING**. | Jamais de lot de paiement fournisseur sur Belfius ou BNP. |
| B9 | Olivier ne sait pas. | Reste ouvert. |
| B10 | L'agent marque un compte bancaire fournisseur « de confiance » **après vérification**. | La vérification (IBAN sur la facture, cohérence avec l'historique, changement d'IBAN signalé) précède toujours le marquage. Un changement d'IBAN est un signal d'alerte : vérifier avant de payer. |
| B11 | L'agent peut lettrer et joindre une pièce, **une ligne par document**, comme l'ERP le fait déjà quand les pièces sont encodées à temps. | Jamais un paiement global pour plusieurs pièces. |

## Décisions du 05/10/2026

| Réf. | Décision | Ce que ça change pour les agents |
|---|---|---|
| A1 | Modèle validé : **l'agent prépare, une personne valide, VD Soft exécute**. Chaque action garde la trace de qui l'a préparée et de qui l'a validée. L'API des agents passe par le compte de l'app (A2) et vise **explicitement sa société** à chaque appel. | Aucune action d'agent ne s'exécute sans validation humaine, sauf les exceptions ci-dessous. |
| Florent | Prépare les lots de paiement et les encodages ; **Olivier valide**. | Florent ne valide pas lui-même un lot de paiement. |
| Élodie | Les notes de crédit et les refacturations peuvent être **validées et partir directement, même la nuit**, à condition qu'elle soit **certaine** qu'elles sont correctes. Au moindre doute, elle prépare seulement. | **Seule exception** à « la nuit, rien ne part ». Elle ne couvre que les notes de crédit et les refacturations. |
| Benoît | Peut **envoyer directement** au comptable les documents retrouvés, avec **mobi@verviersdepannage.be en copie**. | Envoi direct permis pour les pièces retrouvées seulement ; toute autre réponse au comptable reste préparée. |
| E1 | Les rappels de paiement partent **aussi aux assistances**. | Agnès inclut les assistances dans ses rappels (avec le ton adapté à un partenaire). Le Parquet et les Frais de justice restent exclus. |
| Thibault | Recommandation transmise à Olivier (décision attendue) : le robot continue de produire les états de frais ; Thibault contrôle avant envoi ce que le robot ne sait pas vérifier (km, PV, châssis, période déjà payée, suffixes) et porte seul les exceptions (levées, annulations, refus, forclusion, Domaine). | Le robot n'est pas modifié pour l'instant. |
