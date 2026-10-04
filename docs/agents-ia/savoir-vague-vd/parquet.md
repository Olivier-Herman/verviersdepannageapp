# Savoir de l'agent « Parquet » — états de frais de A à Z

> Date de rédaction : **04/10/2026**
> Public : **Thibault** (agent HOOS dédié à Verviers Dépannage, qui porte seul le circuit des états de frais), et en lecture **Raphaël** (fourrière de nuit) et **Lucie** (fourrière). Les agents HOOS ne sont pas des employés de VD.
> Point de départ : `docs/agents-ia/fourriere.md` (Lucie, 03/10/2026), sections 2.4 à 2.6. **Ce document ne la recopie pas, il la complète** : ce qui manque pour porter le circuit seul, les contrôles, les chiffres réels et les écarts entre le mode d'emploi et le comportement réel de l'application.
> Sources : code de VD Soft (référencé `fichier:ligne`), migrations, mode d'emploi « Fourrière + Facturation », mémoire des décisions d'Olivier (alias **« Mobi »** ou **« IT »**, jamais « la direction »), comptages en lecture seule de la base au 04/10/2026.
> Convention : **« à confirmer »** = point non tranché ou non vérifié. Ne jamais le présenter comme acquis. Aucune plaque ni aucun nom de particulier dans ce document ; les exemples sont fictifs.

---

## 0. Ce que Thibault doit savoir en une page

1. Le circuit Parquet ne concerne **que la source « Police – Saisie »**. Un AVP, une mal garée, un rodéo, un accident n'y entrent jamais, même avec un motif de saisie hérité (règle du 22/09 et du 23/09/2026).
2. Un **robot de l'application** fait déjà presque tout : il intègre les nouvelles saisies, établit et **envoie seul** les états de frais (EDF) dus chaque matin, relance le **policier** pour le réquisitoire, lit les retours signés arrivés par mail, **dépose seul sur JustInvoice** l'EDF validé, crée la **facture brouillon** à la liquidation. Le mode « envoi automatique » est **activé** au 04/10/2026.
3. Le rôle de Thibault n'est donc pas d'envoyer : c'est de **surveiller ce que le robot ne voit pas ou fait mal**, de **préparer** les gestes humains (retour papier, refus, note de crédit, facture à poster, correction de fiche) et de **remonter** à temps (forclusion, refus, incohérences).
4. Trois humains seulement agissent vers l'extérieur : le bureau fourrière, Jona (facturation), Olivier. Thibault prépare, ne valide rien, n'envoie rien.
5. **Jamais de relance automatique au Parquet.** Le seul rappel au Parquet est manuel, discret, proche de la forclusion, décidé par Olivier.
6. **Forclusion** : 6 mois pour introduire un EDF sur JustInvoice, comptés depuis la plus ancienne prestation de l'EDF (le jour d'entrée au parc si l'EDF contient le dépannage).
7. Le circuit a des **trous connus** (section 8) : annulation après levée non automatisée, suffixes -B/-C mal lus au scan, facture propriétaire non déduite de l'EDF quand elle est faite par « Facturer », retours classés hors boîte de réception non lus, rejets Peppol non captés. Thibault doit les connaître par cœur.

---

## 1. Les acteurs et les boîtes

| Acteur | Rôle dans le circuit | Comment on le joint | Source |
|---|---|---|---|
| **Parquet** (division de Huy, partenaire de facturation n° 65, Quai d'Arona 4, 4500 Huy) | Destinataire des EDF des saisies « générales » et « défaut d'assurance » ; signe l'EDF pour accord | Boîte réglée `mail_parquet` (fdj.pplge@just.fgov.be) | `src/lib/settings/business-registry.ts:32`, `src/lib/missions/saisie-dossier.ts:114` |
| **Frais de justice Verviers** (partenaire n° 67) | Destinataire si motif « Saisie judiciaire » **ou** levée payée « frais de justice » | Boîte réglée `mail_frais_justice` (frais.justice.verviers@just.fgov.be) | `business-registry.ts:20,33`, `saisie-dossier.ts:36-38` |
| **Bureau de taxation de Liège** | Taxe les EDF déposés ; écrit « Dossier NNNNNN-AA – Changement de statut » | Expéditeur Taxation.Liege@just.fgov.be vers fourriere@ | `saisie-mail-watch.ts:5-9,26` |
| **JustInvoice** | Portail SPF Justice : dépôt de la créance, renvoie un n° de dossier (format `535059-26`) | Dépôt automatique par l'application ; compte au nom de VD | mémoire `project_justinvoice_spf_justice` |
| **Policier** | Fournit le réquisitoire (72 h légales) | Contact lié sur la fiche ; mail depuis fourriere@ ; portail policier | Lucie §2.5 |
| **Service Peppol du SPF Justice** | Rejette les factures non conformes | peppol.aca@just.fgov.be (rejet reçu le 13/07/2026 pour 11 notes de crédit) | mémoire `project_audit_facturation_parquet_2026-09-03` |
| **Boîte fourriere@verviersdepannage.be** (attention : **.be**) | Expéditeur de tout le circuit ; reçoit retours, statuts, réquisitoires | — | `saisie-dossier.ts:16`, `saisie-relance.ts:20` |

---

## 2. La carte complète du circuit

| # | Étape | Qui agit | Écran VD Soft | Ce que Thibault contrôle |
|---|---|---|---|---|
| 1 | Entrée au parc (source Police – Saisie) | Chauffeur / bureau | Fiche, Parc | Source correcte ; châssis, marque, modèle, n° de PV présents |
| 2 | Intégration au suivi Parquet | Robot (chaque matin + à l'ouverture de l'écran) | **États de frais** | Saisie présente dans le suivi ; pas de dossier pour une fiche requalifiée |
| 3 | Réquisitoire PDF/JPG annexé | Policier / robot de lecture / bureau | Fiche (encadré Saisie), **Réquisitoires**, **Relance réquisitoires** | Document valable ; policier lié (sinon aucune relance possible) |
| 4 | 1er EDF dû : **dernier jour du mois suivant l'entrée** | Robot (envoi auto) | États de frais (onglet « À nous ») | Lignes, période, destinataire, solde client déduit |
| 5 | Attente du retour signé | Parquet | États de frais (« Chez eux ») | Compteur d'attente, niveau de forclusion |
| 6 | Retour signé (accord / refus) | Parquet → robot (mail) ou bureau (papier, scan) | « Retour signé reçu », « Scan groupé des retours signés » | Bon EDF rattaché ; refus écrit dans le mail |
| 7 | Dépôt JustInvoice | Robot (auto après validation) ou bouton « Déposer sur JustInvoice » | États de frais | N° de dossier JustInvoice reçu ; sinon échec à remonter |
| 8 | Taxation puis « Transféré au bureau de liquidation » | Bureau de taxation → robot (mail) | États de frais (« Liquidation OK ») | Statut autre que liquidation = alerte humaine |
| 9 | Facture brouillon au Parquet (réf. `ROJ-FJGK13 JINV<n°>`, pièces jointes) | Robot ; à défaut bouton « Créer la facture » | États de frais → logiciel de facturation | Total identique à l'EDF taxé ; pièces jointes présentes |
| 10 | Facture postée → envoi électronique Peppol | **Humain** (bureau / Olivier) dans le logiciel de facturation | — | Référence de commande correcte ; pas de rejet Peppol |
| 11 | Paiement ~30 jours après dossier complet | SPF Justice | Logiciel de facturation | Lettrage (hors périmètre Thibault, signaler) |
| 12 | Gardiennage récurrent : un EDF tous les 2 mois | Robot | États de frais | Même contrôles qu'à l'étape 4 |
| 13 | Fin : levée, remise au Domaine, sortie | Bureau / police / SPF Finances | Fiche, États de frais, Domaine | Clôture correcte, aucun EDF de trop |

**Machine à états du dossier** (base) : `en_parc → a_facturer → ef_envoye → accepte | refuse → justinvoice → liquide → facture → gardiennage_recurrent → clos` (`saisie-dossier.ts:104-107`). **Chaque EDF a son propre statut** : envoyé, validé, refusé, déposé, liquidé, facturé, à annuler, annulé (`src/app/fourriere/saisies/SaisiesClient.tsx:68-72`). On facture l'EDF **qu'on scanne**, jamais « le dernier » (mémoire `project_facturation_saisie_module`, 10/08/2026).

---

## 3. Le détail, étape par étape

### 3.1 L'écran « États de frais » (titre « États de frais Parquet »)

- Accès : administrateurs, superadministrateurs et utilisateurs ayant le module fourrière (`src/app/fourriere/saisies/page.tsx:18`).
- Onglets : **À nous** (une action du bureau, un seul bouton), **Chez eux** (on attend le Parquet, un policier, JustInvoice ou le Domaine), **En veille** (rien avant une date connue), **Clôturés**, **Tous** (`SaisiesClient.tsx:291-297`). Tri : forclusion la plus urgente d'abord, puis « À nous », puis date d'entrée (`:284-287`).
- Chaque carte = une frise Entrée → Réquisitoire → États de frais → Parquet → JustInvoice → Facture (+ Domaine ou Levée, + Clôturé) et **une seule prochaine action** calculée dans cet ordre de priorité (`:146-184`) : clôturé → en pause → remis au Domaine → note de crédit à envoyer → réquisitoire manquant → EDF refusé → en attente du Parquet → validé, à déposer → déposé, attente taxation → liquidé, créer la facture → EDF à établir → levée client → première période pas atteinte → tout facturé → prochain EDF à une date.
- Bandeau du robot : « Robot du matin » ; il signale les erreurs du dernier passage ou un robot muet depuis plus de 36 h (`:298-300`). **Au 04/10/2026, le dernier passage (09:31 heure belge) portait 5 erreurs**, toutes « Date IN Domaine antérieure à l'entrée en parc — corriger la fiche ».
- Boutons secondaires dans « Détails » : Aperçu, Renvoyer corrigé, Refusé, JustInvoice, « Facturer maintenant » (sans attendre la liquidation), Relancer (rappel Parquet), Relancer le policier, Pause / Reprendre, Clôturer, **Retirer du suivi**, Journal.
- ⚠️ **« Retirer du suivi » supprime les états de frais du dossier** (message de confirmation, `SaisiesClient.tsx:253`). Thibault ne le propose jamais pour un dossier dont un EDF est parti.

### 3.2 Entrée dans le suivi

- **Auto-intégration** : toute saisie en parc reçue depuis le **10/08/2026** crée son dossier (`saisie-dossier.ts:84-101` ; réglage `saisie_autointegrate_since`). Les saisies hors circuit (levée, déjà sortie) ne sont pas intégrées (`:97`).
- **Périmètre** : le réglage `saisie_scope_from` = 01/06/2026 ne gouverne que l'intégration automatique ; **tout dossier existant est traité**, même plus ancien (`saisie-cron.ts:100-103`). Saisies antérieures intégrées à la main si moins de 6 mois (décision du 16/09/2026).
- **Levée « frais de justice »** sur une saisie sans dossier : le dossier est **créé automatiquement**, même hors périmètre (`src/app/api/missions/[id]/levee-saisie/route.ts:152-165`).
- **Fiche requalifiée** (AVP, mal garée, rodéo d'après le réquisitoire) : le robot clôt le dossier ; si un EDF était déjà parti, il note « à régulariser » et le signale en erreur (`saisie-cron.ts:116-124`).
- **Fiches anciennes du logiciel précédent** : depuis le **23/09/2026**, seule la source Police – Saisie porte le circuit ; une fiche ancienne doit d'abord être requalifiée (migration `202609231000_saisie_scope_police_saisie_only.sql`). Requalification = décision d'Olivier.

### 3.3 Le réquisitoire : ce qui débloque tout

- Un réquisitoire est **valable** seulement si une date de réception est posée **et** que le document est un **PDF, JPG ou JPEG** (`src/lib/requisitoire/doc.ts:8,20-22`). Un PNG ou une capture de mail ne passe pas.
- Sans réquisitoire valable : **pas d'EDF** (`saisie-dossier.ts:211-213`), **pas de dépôt JustInvoice** (`src/lib/justinvoice/deposit.ts:40`), et le robot ajoute le policier à la relance groupée (un mail par policier, au plus tous les 7 jours, **seulement si le policier est lié à la fiche**) (`saisie-cron.ts:214-222`).
- **Au 04/10/2026 : 78 dossiers ouverts sur 180 n'ont pas de réquisitoire valable, dont 72 sans policier lié.** Ces 72 ne seront **jamais** relancés tant que personne ne lie le policier (« Identifier le policier » / « Modifier » dans Relance réquisitoires). C'est le premier levier de Thibault : lister ces fiches pour le bureau.
- Le motif coché sur le réquisitoire décide de la source (Lucie §2.5). Un formulaire **judiciaire** coché « accident » reste une **saisie** (`src/lib/requisitoire/requalify.ts:19-26`). Une lecture douteuse (formulaire judiciaire avec motif administratif, ou l'inverse) ne requalifie rien (`requalify.ts:39-43`) : à vérifier à la main.

### 3.4 Le calcul d'un état de frais

**Date de coupe (jamais saisie à la main)** (`saisie-dossier.ts:237-248`) :
- 1er EDF : **dernier jour du mois suivant l'entrée** (entrée le 14/07 → coupe le 31/08) (`:128-131`). Avant cette date, l'EDF est refusé (« Première période non atteinte ») sauf remise au Domaine ou levée « frais de justice » (`:223-228`).
- EDF suivants : **dernière coupe + 2 mois** (`:248`).
- Remise au Domaine : coupe = **date de remise** (EDF de clôture).
- Levée « frais de justice » définitive : coupe = **date de levée** (`:217-218,246`).
- **Jamais plus d'une période par EDF** : si la coupe visée dépasse la période standard, l'EDF s'arrête à la période standard et une **série** (EDF-…, -B, -C) part dans le **même mail** (`:251-260`, `:516-526`).
- **Garde-fou** : une coupe antérieure au début de période (typiquement une date de remise Domaine encodée avant l'entrée au parc) bloque l'EDF avec le message « Date de coupe incohérente » (`:263-265`, `saisie-cron.ts:178-183`).

**Début de période** = la plus tardive de : dernière coupe Parquet, **date jusqu'où le propriétaire a payé**, date d'entrée (`saisie-dossier.ts:250`). Le dépannage n'est mis que s'il n'a été facturé ni au Parquet ni au propriétaire (`:266`).

**Lignes** (`src/lib/missions/saisie-billing.ts`) :
| Ligne | Règle | Source |
|---|---|---|
| Prise en charge | 1er EDF seulement ; tarif de l'année d'entrée | `saisie-billing.ts:127-131` |
| Km | Seulement **au-delà de 30 km aller-retour** ; saisis à l'établissement, **0 par défaut** (l'envoi automatique et « Envoyer les … » comptent 0) | `saisie-dossier.ts:160,269-271`, `SaisiesClient.tsx:249` |
| Gardiennage saisie | **Nuits** ; le jour d'entrée n'est jamais compté ; découpé par année civile, chaque partie à son tarif | `saisie-billing.ts:79-90,141-155` |
| Gardiennage après levée | 20 €/nuit (ligne « hors période saisie ») | `saisie-billing.ts:158-166` |
| Frais administratifs | **Client uniquement**, jamais Parquet ni Domaine | `saisie-billing.ts:169-173` |
| TVA | 21 % sur le total HTVA | `saisie-billing.ts:176` |

**Ordre de grandeur réel (96 premiers EDF au 04/10/2026)** : moyenne 189 € HTVA, médiane 153 € ; EDF suivants (gardiennage seul) : médiane 97 €. Période moyenne : 39 jours, maximum 62 jours. Un EDF à plusieurs centaines d'euros sur une seule période doit faire vérifier les km et la date d'entrée.

**Contenu du PDF** : émetteur VD (Lefin 12, 4860 Pepinster), destinataire avec adresse, e-mail et TVA, n° EDF en grand, véhicule (plaque **facultative si le châssis est présent**), n° de PV, motif, lignes, totaux HTVA / TVA / TVAC, **QR de rattachement** (lien de dépôt du retour signé, pas un QR de paiement) (`saisie-dossier.ts:334-350`, mémoire 21/09/2026).

### 3.5 Destinataire et envoi

- Routage (`saisie-dossier.ts:40-54`) : **Frais de justice** si motif « Saisie judiciaire » **ou** levée payée « frais de justice » ; sinon **Parquet**. Répartition des motifs au 04/10/2026 : défaut d'assurance 153, saisie judiciaire 52, saisie générale 37, sans motif 46. **Un dossier sans motif part au Parquet** : vérifier le motif avant le 1er EDF.
- Le mail part de fourriere@ ; objet « État de frais EDF-AAAA-NNNN — <plaque ou châssis> » ; **EDF + réquisitoire joints** ; texte courtois demandant le retour signé « pour accord ou pour refus », avec bouton de dépôt en ligne (`saisie-dossier.ts:456-485,540-567`). Pas de copie interne.
- Après envoi : dossier « envoyé », journal « État de frais … envoyé à … » (`:572-579`).
- ⚠️ L'écran affiche la boîte destinataire **d'après le seul motif** (`SaisiesClient.tsx:78-83`) : pour une levée « frais de justice » sur un motif « défaut d'assurance », l'écran montre la boîte Parquet alors que le mail part bien aux Frais de justice. Croire le journal, pas l'étiquette.
- **Erreur de boîte constatée** : un EDF parti au Parquet alors qu'il relevait des Frais de justice se corrige par une **levée « frais de justice » sur la fiche puis un renvoi du même EDF (même numéro)** ; l'agent mail sait le faire sur consigne humaine (`src/lib/mail-agent/consignes.ts:29,112-126`).
- **Renvoyer corrigé** : même numéro, données véhicule actuelles, réquisitoire joint, l'EDF repasse « envoyé » (`saisie-dossier.ts:408-449`). Cas type : le Parquet renvoie l'EDF parce que marque, châssis ou PV ne collent pas avec le réquisitoire (cas réel du 03/09/2026).

### 3.6 L'attente du retour et la forclusion

- **Délai réel** : sur 4 retours datés, 28 jours en moyenne entre envoi et retour (maximum 37) ; 1 liquidation 25 jours après le retour. **109 EDF sont « envoyés » au 04/10/2026**, attente médiane 31 jours, maximum 56 jours, aucun au-delà de 60 jours.
- **Forclusion** (AR du 15/12/2019, art. 41) : 6 mois « à dater du jour de l'exécution de la prestation ». Lecture prudente codée : base = **date d'entrée au parc si l'EDF contient le dépannage**, sinon début de la période de l'EDF ; l'horloge s'arrête au **dépôt JustInvoice** (`src/lib/missions/saisie-relance.ts:5-9,22-34`).
- Alertes une seule fois par palier : 60 j, 30 j, 7 j (ou dépassée) (`saisie-relance.ts:43-49`, `saisie-cron.ts:276-300`). Au 04/10/2026 : **4 EDF au palier 7 jours ou dépassé, 2 au palier 30 jours, 3 au palier 60 jours** (saisies anciennes intégrées tard : leur dépannage date de l'entrée).
- **Conséquence** : pour une saisie intégrée tard, le 1er EDF peut naître déjà proche de la forclusion. Thibault le repère dès l'établissement et le remonte le jour même.
- **Rappel au Parquet** (bouton « Relancer » dans Détails) : uniquement un EDF « envoyé », mail courtois « (rappel) » avec l'EDF reconstruit (`saisie-relance.ts:82-125`). **Aucun rappel n'a été fait au 04/10/2026.** Décision d'Olivier, au cas par cas, quand la forclusion approche ; jamais en série.

### 3.7 Le retour signé : quatre portes

| Porte | Ce qui se passe | Piège |
|---|---|---|
| **Lien de dépôt** (QR / bouton du mail) | Le dépôt marque l'EDF validé, puis dépôt JustInvoice automatique si le robot est en envoi auto | — |
| **Mail du Parquet avec PDF** | Le robot (toutes les 10 min) découpe le PDF, lit chaque n° EDF, rattache, marque accord ou refus ; **un refus écrit dans le corps du mail l'emporte** sur la page (« ne correspond pas », « vous retourne », « refus », « à corriger », « non conforme »…) ; dépôt auto seulement si le mail n'est pas négatif **et** que toutes les pages sont reconnues (`saisie-mail-watch.ts:109-166`, regex `:122`, condition `:147`) | Ne lit que **la boîte de réception** (`:172`) : un retour classé dans un sous-dossier n'est jamais vu. 3 PDF analysés au plus par passage (`:28`). |
| **« Scan groupé des retours signés »** (courrier papier scanné) | Une page = un EDF ; lecture du n° et d'une mention de refus ; rattache, marque validé ou refusé (`saisie-scan-split.ts`) | Le n° lu est **tronqué de son suffixe** : « EDF-2026-0071-B » est lu « EDF-2026-0071 » (`saisie-scan-split.ts:41`). 23 EDF suffixés existent. Voir §8. |
| **« Retour signé reçu »** (un fichier) / boutons Accepté / Refusé | Secours pour un retour isolé ou un accord sans document | Un « Accepté » sans document ne pourra pas être déposé : le dépôt exige l'EDF signé (`deposit.ts:31`). |

Après un **refus** : la carte dit « Corriger la fiche puis refaire un état de frais, ou renvoyer corrigé » (`SaisiesClient.tsx:155-156`). Au 04/10/2026, 8 EDF « refusés » : 6 sont en réalité des **annulations** d'envois erronés (véhicules requalifiés, annulation écrite au Parquet le 03/09/2026), 2 sont de vrais refus du Parquet. Lire la note de l'EDF avant de conclure.

### 3.8 Le dépôt JustInvoice

- Pièces envoyées : **l'EDF signé deux fois** (rubrique « État de frais » et rubrique « Approbation », car l'approbation est portée sur l'EDF) + **le réquisitoire** (« Réquisition ») ; bureau de taxation Liège ; type « levage et gardiennage de véhicules » ; commentaire « #<n° de mission> - <n° EDF> » (`deposit.ts:45-52`, mémoire 10/08/2026).
- Conditions (`deposit.ts:29-40`) : EDF au statut **validé**, EDF signé présent, réquisitoire PDF/JPG présent.
- Automatique après **toute** validation si le robot est en envoi auto et le dossier pas en pause (`deposit.ts:76-85`) ; sinon bouton « Déposer sur JustInvoice » (confirmation « Action réelle »).
- Succès : EDF « déposé », n° de dossier JustInvoice sur l'EDF et la fiche (`deposit.ts:58-66`). Échec : journal « Dépôt JustInvoice … refusé » et erreur au robot ; **Thibault remonte à Olivier** (le compte et le flux de dépôt relèvent d'IT).
- **Une fois sur JustInvoice, l'EDF ne se signe plus**. Une correction de taxation = **nouvel EDF + note de crédit avec le même n° JustInvoice** (directive SPF du 22/12/2025, mémoire 03/09/2026).
- Au 04/10/2026 : **2 EDF portent un n° JustInvoice**. Le circuit réel n'a tourné de bout en bout qu'**une fois**.

### 3.9 Liquidation, facture, Peppol, paiement

- Le robot lit le mail « Dossier NNNNNN-AA – Changement de statut » (`saisie-mail-watch.ts:26,52-106`) :
  - statut « **Transféré au bureau de liquidation** » → EDF « liquidé » → **facture brouillon** créée tout de suite ;
  - **tout autre statut** (demande de correction, refus, clôture…) → note sur l'EDF + notification « statut JustInvoice … à vérifier » ;
  - n° inconnu de VD Soft (dossier de l'ancien système) → noté sans alerte. **15 mails de ce type** ont été vus : normal.
- **Facture** (`src/lib/missions/saisie-odoo-invoice.ts`) : partenaire **Parquet n° 65**, lignes identiques à l'EDF (périodes en clair), « N° de commande » = **`ROJ-FJGK13 JINV<n° JustInvoice>`** (exigence SPF : sinon « aucune suite »), description avec n° EDF, n° de notice/PV, véhicule, période ; **pièces jointes** : EDF approuvé + réquisitoire (`:23-32,69-71,80-123`). Pas de n° JustInvoice = pas de facture (`:71`).
- **La facture reste en brouillon.** Un humain la vérifie et la **poste** dans le logiciel de facturation ; l'envoi Peppol part de là. Thibault vérifie avant de proposer : total = total de l'EDF taxé, n° de commande exact, deux pièces jointes.
- « Facturer maintenant » (sans attendre la liquidation) existe pour un EDF déposé (`saisie-odoo-invoice.ts:46-50`) : **ne pas le proposer** sauf demande d'Olivier, le processus SPF veut la facture après liquidation.
- **Paiement** : environ 30 jours après dossier complet. Le SPF n'est **jamais** relancé en impayé (`docs/agents-ia/facturation.md:21,191`).
- ⚠️ Les **rejets Peppol** (expéditeur peppol.aca@just.fgov.be) et les mails « Fichiers à scinder » / « Dossiers hors délais » du bureau de taxation **ne sont pas lus par le robot** (aucune trace dans le code). Thibault les cherche lui-même dans fourriere@ et l'agent mail, et les remonte.

### 3.10 Cas particuliers

**a) Le propriétaire paie sans levée** (le policier l'exige parfois) : on peut toujours le facturer, le véhicule reste au parc ; seule la restitution exige la levée (Lucie §2.6). Le Parquet ne doit payer que le **solde**. ⚠️ Seule la déclaration « **Déjà facturé…** » de la Vue dossier inscrit la période payée sur le dossier Parquet (`src/app/api/dossier/[id]/mark/route.ts:62-84`). Une facture faite par le bouton « **Facturer** » ne l'inscrit pas (aucune écriture de la date payée ailleurs dans le code). Avant tout EDF suivant une facture propriétaire, Thibault vérifie que la période payée est bien exclue ; sinon il bloque (pause par le bureau) et remonte.

**b) Levée de saisie « à charge du client »** (définitive) : la levée **exige** de dire qui paie (`levee-saisie/route.ts:83-85`) ; le gardiennage est coupé au jour de la levée et un nouveau groupe « autre » s'ouvre le lendemain, sans payeur (`:174-200`) ; le dossier Parquet est clos **si aucun EDF n'est parti** (`saisie-cron.ts:65-86`, `levee-saisie/route.ts:205-214`).
  Si un EDF est **déjà parti** : le dossier reste ouvert pour suivre l'EDF. Le mode d'emploi annonce un passage automatique « À ANNULER » avec notification à la facturation : **ce n'est pas codé** (aucune écriture du statut « à annuler » ; le bouton « Note de crédit envoyée » renvoie une erreur car l'action n'accepte que Accepté / Refusé, `src/app/api/fourriere/saisies/[id]/ef-status/route.ts:26`). Thibault doit donc **détecter lui-même** toute levée client sur un dossier avec EDF parti, préparer le dossier de note de crédit (EDF concerné, montant, période) pour Jona / Olivier, et surveiller qu'aucun EDF récurrent ne reparte. Au 04/10/2026 : **0 cas ouvert**.

**c) Levée « frais de justice »** : le dossier reste au Parquet ; série finale jusqu'à la date de levée, envoyée sans attendre la 1re période, aux **Frais de justice** ; payeur de la fiche posé sur le partenaire Frais de justice n° 67 (`levee-saisie/route.ts:131-135`, `saisie-cron.ts:202-206`). Au 04/10/2026 : **8 dossiers ouverts** dans ce cas. Ensuite, sortie physique par « Véhicule repris par le propriétaire » (encadré Saisie), sans facture.

**d) Levée temporaire** : ne coupe rien, ne clôt rien (`levee-saisie/route.ts:174,205`). Cycle « Sortie vers garagiste » / « Retour en parc » (Lucie §2.6).

**e) Remise au Domaine** : EDF de clôture jusqu'à la date de remise, puis le dossier bascule « Domaine » et n'émet plus rien ; il se clôt seul quand tous ses EDF sont facturés ou refusés (`saisie-dossier.ts:569-577`, `saisie-cron.ts:157-175`). La suite est le circuit de Marion (`domaine.md`). Jamais d'EDF « Domaine » (`saisie-dossier.ts:233-235`). 26 dossiers sont au Domaine au 04/10/2026.

**f) Véhicule sorti hors circuit** (restitué et facturé au client) : le dossier se clôt seul s'il n'a pas atteint JustInvoice (`saisie-cron.ts:138-155`). Au 04/10/2026, 22 dossiers ouverts ont une fiche sortie, terminée ou annulée : à passer en revue un par un avec le bureau (EDF en vol ? clôture oubliée ?).

**g) Dossier incomplet envoyé par erreur** : précédent du 29/09/2026, un EDF parti sans réquisitoire a été **annulé dans VD Soft sans prévenir le Parquet, sur décision d'Olivier**. Ce n'est pas une règle générale : chaque cas est décidé par Olivier.

**h) AVP, mal garée, rodéo, accident** : jamais d'EDF (Lucie §3, règles 6-7). Le 22/09/2026, 11 EDF étaient partis à tort (9 AVP, 1 mal garée) ; ils ont été annulés par écrit.

**i) Restitution au propriétaire avec « qui paie quoi »** : trois postes (dépannage, gardiennage jusqu'à la levée, après la levée), chacun Client / Parquet / Frais de justice (Lucie §2.7). Saisie restituée au propriétaire = pas d'EDF par défaut.

---

## 4. Chiffres de référence au 04/10/2026 (lecture seule de la base)

| Indicateur | Valeur |
|---|---|
| Dossiers Parquet | 288 (100 en parc, 63 EDF envoyé, 14 gardiennage récurrent, 2 refusés, 1 validé, 108 clos) ; 262 au Parquet, 26 au Domaine ; 0 en pause |
| États de frais émis | 119 (109 envoyés, 8 « refusés » dont 6 annulations, 1 annulé, 1 facturé), dont 23 suffixés (-B, -C…) |
| Retours signés reçus | 4 datés ; délai moyen 28 j |
| Dépôts JustInvoice | 2 ; 1 liquidation ; 1 facture |
| Dossiers ouverts sans réquisitoire valable | 78 / 180, dont 72 sans policier lié |
| Alertes de forclusion actives | 4 (≤ 7 j ou dépassée), 2 (≤ 30 j), 3 (≤ 60 j) |
| Rappels manuels au Parquet | 0 |
| Mode du robot | Envoi automatique **activé** |
| Dernier passage du robot | 04/10/2026, 09:31 heure belge : 0 envoi, 2 relances policier, 4 intégrations, 3 alertes de forclusion, 5 erreurs « Date IN antérieure à l'entrée » |

---

## 5. Règles fermes

1. **Source Police – Saisie uniquement.** Jamais d'EDF pour AVP, mal garée, rodéo, accident, fiche ancienne non requalifiée.
2. **Pas de relance automatique au Parquet**, ni en série. Rappel manuel = décision d'Olivier, près de la forclusion.
3. **Pas d'EDF sans réquisitoire PDF/JPG.** La relance vise le **policier**, jamais le Parquet.
4. **Une période par EDF** ; rattrapage = série dans un même mail.
5. **Frais administratifs : jamais** au Parquet, aux Frais de justice ni au Domaine.
6. **Nuits**, jamais le jour d'entrée ; tarif saisie pour toute la période sous saisie, quel que soit le payeur.
7. **Le Parquet ne paie que le solde** de ce que le propriétaire n'a pas payé.
8. **Levée client** : plus rien au Parquet ; EDF déjà parti = note de crédit (humain).
9. **Levée frais de justice** : EDF final jusqu'à la levée, adressé aux Frais de justice.
10. **Domaine** : EDF de clôture jusqu'à la remise ; ensuite plus aucun EDF.
11. **Forclusion 6 mois** : priorité absolue, remontée le jour même.
12. **Facture Parquet** : brouillon, `ROJ-FJGK13 JINV<n°>`, EDF approuvé + réquisitoire joints, total identique ; jamais de rapport d'intervention joint ; postée par un humain.
13. Correction de taxation : nouvel EDF + note de crédit, **même n° JustInvoice**.
14. Mails depuis **fourriere@verviersdepannage.be** ; ton « Madame, Monsieur », « Auriez-vous l'amabilité… » ; **ne jamais dévoiler l'automatisation** ; pas de « rappel n° ».
15. Pas de rejeu des mails passés ; on corrige pour le futur.
16. Jamais de suppression (ni « Retirer du suivi » d'un dossier avec EDF parti, ni ligne de commande confirmée).

---

## 6. Ce que Thibault fait, ne fait jamais, remonte

### Fait (lecture, préparation, brouillons)
- Chaque jour ouvrable, lit l'écran **États de frais** onglet par onglet et le bandeau du robot ; tient une liste « à traiter aujourd'hui » pour le bureau.
- Vérifie chaque EDF parti la veille : destinataire, période, km, solde propriétaire, châssis / marque / PV cohérents avec le réquisitoire.
- Liste les dossiers **sans réquisitoire** et surtout **sans policier lié**, avec la zone et la date d'entrée, pour que le bureau lie le policier.
- Cherche dans fourriere@ (toute la boîte, pas seulement la réception) : retours signés classés ailleurs, rejets Peppol, mails du bureau de taxation autres que la liquidation.
- Prépare les dossiers de **note de crédit** (levée client après EDF, correction de taxation) et les **brouillons** de réponse au Parquet, dans le fil, pour relecture humaine.
- Contrôle chaque **facture brouillon** du circuit avant qu'un humain la poste.
- Tient le tableau de **forclusion** : EDF, date limite, qui a la main.

### Ne fait jamais
- Envoyer, renvoyer, relancer, déposer sur JustInvoice, créer ou poster une facture, marquer accepté / refusé / annulé, mettre en pause, clôturer, retirer du suivi.
- Modifier une fiche (source, motif, dates, levée, Domaine, policier).
- Écrire au Parquet, au bureau de taxation, au SPF ou à la police ; mentionner un automatisme ; écrire « à charge de la commune ».
- Proposer un EDF pour un AVP, une mal garée, un rodéo.
- Basculer le robot entre envoi automatique et « Prépare + Alerte ».

### Remonte (à qui, quand)
| Situation | À qui | Délai |
|---|---|---|
| Forclusion ≤ 30 jours ou dépassée | Olivier | Le jour même |
| Refus du Parquet, statut JustInvoice autre que liquidation, rejet Peppol | Olivier + bureau fourrière | Le jour même |
| Échec de dépôt JustInvoice ou de création de facture | Olivier (IT) | Le jour même |
| Levée client avec EDF déjà parti ; propriétaire qui a payé par « Facturer » | Jona + Olivier | Avant le prochain passage du robot |
| Date de remise Domaine antérieure à l'entrée, fiche requalifiée avec EDF parti | Bureau fourrière / Olivier | Dans la journée |
| Policier non lié, réquisitoire non valable (HTML, PNG) | Bureau fourrière | Liste quotidienne |
| Facture brouillon à poster | Bureau / Jona | Liste quotidienne |
| Défaut de l'application (§8) | Olivier, avec la fiche, l'heure, l'écran | Dès constat |

---

## 7. Travail de nuit (Raphaël, ou Thibault la nuit)

- **Rien ne part la nuit du fait d'un agent.** La nuit sert à **préparer** : relevé des dossiers à traiter, contrôles des EDF prévus le matin, brouillons de réponse, liste des forclusions.
- Ce que l'application fait seule, à connaître pour ne pas s'en étonner :
  - la lecture de fourriere@ tourne **toutes les 10 minutes, jour et nuit** (`vercel.json:21`) : un retour signé arrivé la nuit peut être **déposé sur JustInvoice la nuit même** (mode envoi auto) et une facture brouillon peut naître à la réception d'un mail de liquidation ;
  - le robot du matin tourne à **07:30 UTC** (`vercel.json:23`), soit **09:30 heure belge jusqu'au 25/10/2026, 08:30 ensuite** : c'est lui qui envoie les EDF dus et les relances policier.
- La nuit, Thibault prépare pour 08:00 une note de passation : EDF qui vont partir au passage du matin (avec les points à vérifier avant, pour qu'un humain mette en pause si besoin), retours reçus dans la nuit, dépôts faits, erreurs.
- Si une erreur grave est visible la nuit (EDF parti au mauvais destinataire, AVP en EDF), Thibault **n'agit pas** : il note, prépare le brouillon d'annulation et le signale en tête de la passation. Aucune urgence Parquet ne justifie de réveiller quelqu'un.

---

## 8. Pièges connus (constatés dans le code au 04/10/2026)

1. **Annulation après levée client non automatisée** : le statut « à annuler » n'est jamais posé par l'application ; le bouton « Note de crédit envoyée » échoue (`ef-status/route.ts:26`). Le mode d'emploi (fonction 126b) décrit un automatisme qui n'existe pas. Suivi manuel obligatoire.
2. **Suffixe -B / -C perdu au scan groupé et dans la lecture des retours par mail** (`saisie-scan-split.ts:41`) : la page signée d'un EDF suffixé est rattachée à l'EDF de base, qui passe « validé » à tort, et l'EDF suffixé reste « envoyé ». Après chaque retour d'une série, vérifier EDF par EDF.
3. **Facture propriétaire par « Facturer » non déduite de l'EDF** (seul « Déjà facturé… » l'est, `mark/route.ts:62-84`) : risque de double facturation propriétaire + Parquet.
4. **Retours signés hors boîte de réception non lus** (`saisie-mail-watch.ts:172`).
5. **Rejets Peppol et autres mails du bureau de taxation non lus** (« Fichiers à scinder », « Dossiers hors délais »).
6. **Rappel manuel au Parquet mal routé après une levée « frais de justice »** sur un motif non judiciaire : la fonction de rappel ne lit pas le payeur de la levée (`saisie-relance.ts:92-96`) et enverrait au Parquet au lieu des Frais de justice.
7. **Boîte affichée selon le seul motif** (`SaisiesClient.tsx:78-83`) ; le journal fait foi.
8. **Facture au partenaire Parquet n° 65 même pour un dossier « frais de justice »** (`saisie-odoo-invoice.ts:23`) — à confirmer avec Olivier (question 3).
9. **Km à 0 par défaut** dans l'envoi automatique : un enlèvement lointain est sous-facturé si personne ne corrige.
10. **Date de remise Domaine antérieure à l'entrée** : bloque l'EDF de clôture ; 5 dossiers au 04/10/2026.
11. **« Retirer du suivi » supprime les EDF du dossier**.
12. Commentaire de code trompeur : `saisie-billing.ts` parle de « 15 km inclus » ; la règle est **30 km aller-retour** (`saisie-dossier.ts:160`).
13. Les **boutons de la carte suivent l'état global du dossier** : avec plusieurs EDF en vol, ouvrir « Détails » et agir EDF par EDF.
14. **Écran figé après une mise à jour** : recharger deux fois avant de conclure à une panne.

---

## 9. À confirmer (questions précises pour Olivier)

1. Après une levée « à charge du client » avec EDF déjà parti : veux-tu que l'application pose « à annuler » et notifie la facturation, comme l'annonce le mode d'emploi ? En attendant, qui envoie la note de crédit et à quelle adresse (Parquet ou Frais de justice selon l'EDF d'origine) ?
2. Le bouton « Note de crédit envoyée » échoue (bug signalé le 30/09/2026) : correction prévue ?
3. Facture d'un dossier « frais de justice » : partenaire Parquet n° 65 (comme codé) ou partenaire Frais de justice n° 67 ? Et le même code ROJ-FJGK13 ?
4. Lecture des suffixes -B / -C au scan : corriger la lecture ? D'ici là, Thibault vérifie-t-il chaque série à la main ?
5. Facture propriétaire faite par « Facturer » : faut-il que la période payée sorte aussi de l'EDF automatiquement ?
6. Forclusion : la base « date d'entrée si l'EDF contient le dépannage » te convient-elle, ou le bureau de taxation compte-t-il autrement ?
7. Rejets Peppol et mails « Fichiers à scinder » / « Dossiers hors délais » : qui les traite aujourd'hui ? Faut-il les capter ?
8. Km : l'envoi automatique compte 0 km au-delà de la franchise. Faut-il une valeur par zone de police, ou une vérification humaine avant le 1er EDF ?
9. Dossiers sans motif (46) : faut-il bloquer le 1er EDF tant que le motif n'est pas posé ?
10. Rappel manuel au Parquet : à partir de quel seuil Thibault peut-il le **proposer** (palier 30 jours ? 7 jours ?) ?
11. Les 22 dossiers ouverts dont la fiche est sortie, terminée ou annulée : revue à faire avec qui ?
12. Paiement : faut-il que Thibault suive le lettrage des factures Parquet (30 jours), ou est-ce hors de son périmètre ?

---

## 10. Situations d'examen

> Plaques et noms fictifs.

### Situation 1 — Date du premier état de frais
- **Situation** : saisie (défaut d'assurance) entrée le 14/07, réquisitoire reçu le 18/07, policier lié. Personne n'est venu.
- **Question** : quand part le 1er EDF, avec quoi, et à qui ?
- **Bonne réponse** : au passage du robot du 31/08 (dernier jour du mois suivant l'entrée), automatiquement : prise en charge + km au-delà de 30 km aller-retour (0 si non saisi) + gardiennage du 15/07 au 31/08 au tarif saisie de l'année, sans frais administratifs ; destinataire **Parquet** ; réquisitoire joint ; depuis fourriere@. Thibault vérifie ensuite les km, le PV et le châssis.
- **Erreur à éviter** : l'attendre le 14/08 (« un mois ») ; compter la nuit du 14 au 15 deux fois ou le jour d'entrée ; ajouter les frais administratifs.

### Situation 2 — Saisie judiciaire sans réquisitoire depuis deux mois
- **Situation** : saisie judiciaire, aucun réquisitoire, champ policier non lié ; l'écran dit « Réquisitoire manquant ».
- **Question** : que fait Thibault ?
- **Bonne réponse** : rien ne peut partir. La relance automatique ne touche pas ce dossier (policier non lié). Thibault met la fiche sur la liste du bureau « lier le policier » (zone, date, nom encodé par le chauffeur) ; une fois lié, le robot relance le policier. Il surveille la forclusion (la base court depuis l'entrée).
- **Erreur à éviter** : écrire au Parquet ou aux Frais de justice pour obtenir le réquisitoire ; accepter le texte d'un mail du policier comme réquisitoire.

### Situation 3 — Retour d'une série par courrier
- **Situation** : le Parquet renvoie par la poste, signés, EDF-2026-0071 et EDF-2026-0071-B. Le bureau les passe au « Scan groupé ».
- **Question** : que vérifie Thibault ?
- **Bonne réponse** : que **chaque** EDF a changé de statut. La lecture actuelle perd le suffixe : les deux pages risquent d'être rattachées à EDF-2026-0071, la -B restant « envoyée ». Il signale l'écart au bureau (dépôt du retour de la -B par « Retour signé reçu » sur la bonne ligne) et à Olivier (défaut connu).
- **Erreur à éviter** : se fier au message global « 2 validés ».

### Situation 4 — Refus écrit dans le mail
- **Situation** : mail du Parquet : « La marque ne correspond pas au réquisitoire, je vous retourne le tout », avec notre PDF non signé.
- **Question** : quel statut, et quelle suite ?
- **Bonne réponse** : le robot marque l'EDF **refusé** (le texte du mail l'emporte) et ne dépose rien. Thibault compare fiche et réquisitoire, prépare la correction de la fiche pour le bureau puis propose **« Renvoyer corrigé »** (même numéro) ; brouillon de réponse courtois dans le fil, sans mention d'automatisme.
- **Erreur à éviter** : considérer la page non signée comme un accord ; créer un nouvel EDF avec un nouveau numéro.

### Situation 5 — Levée « à charge du client » après un EDF
- **Situation** : EDF parti au Parquet jusqu'au 31/08 ; le 20/09, levée définitive « le client paie ».
- **Question** : que se passe-t-il dans l'application et que doit faire Thibault ?
- **Bonne réponse** : le gardiennage est coupé au 20/09, un groupe « autre » (20 €/nuit) s'ouvre le 21/09 ; le dossier Parquet **n'est pas clos** (un EDF est parti) et **rien ne le marque « à annuler »**. Thibault prépare pour Jona et Olivier : EDF à annuler par note de crédit, période à refacturer au client (tarif saisie jusqu'au 20/09, 20 € ensuite, frais administratifs), et surveille qu'aucun EDF récurrent ne reparte.
- **Erreur à éviter** : croire le mode d'emploi (« passe À ANNULER automatiquement ») ; cliquer « Note de crédit envoyée » (échoue).

### Situation 6 — Levée « frais de justice » sur un défaut d'assurance
- **Situation** : motif « défaut d'assurance », levée définitive « frais de justice » le 10/10 ; le 1er EDF n'est pas encore dû.
- **Question** : destinataire, période, et que montre l'écran ?
- **Bonne réponse** : série finale jusqu'au 10/10, envoyée au prochain passage, aux **Frais de justice** (payeur de la levée). L'écran peut afficher la boîte Parquet (étiquette basée sur le motif) : croire le journal. Si un rappel devait être fait plus tard, la fonction de rappel l'enverrait au Parquet : le signaler à Olivier avant tout rappel.
- **Erreur à éviter** : attendre le dernier jour du mois suivant ; mettre 4 mois sur un seul EDF.

### Situation 7 — Le propriétaire a payé au comptoir
- **Situation** : sans levée, le propriétaire a payé dépannage + gardiennage jusqu'au 15/09 ; le bureau a utilisé « Facturer » dans la Vue dossier. Le prochain EDF part le 31/10.
- **Question** : l'EDF du 31/10 sera-t-il juste ?
- **Bonne réponse** : pas forcément : seule la déclaration « Déjà facturé… » inscrit la période payée sur le dossier Parquet. Thibault vérifie le début de période et la présence du dépannage dans l'aperçu ; si la période payée n'est pas exclue, il demande au bureau de mettre le dossier en pause et remonte à Jona et Olivier avant le passage du robot.
- **Erreur à éviter** : laisser partir un EDF qui refacture au Parquet ce que le propriétaire a payé.

### Situation 8 — Forclusion dépassée
- **Situation** : notification « ⏳ Forclusion DÉPASSÉE » pour un EDF « envoyé » d'une saisie de février intégrée en septembre.
- **Question** : que fait Thibault ?
- **Bonne réponse** : il prépare pour Olivier les faits (EDF, date d'envoi, date limite calculée, base de calcul, historique) et un **brouillon** de rappel courtois. Olivier décide d'un rappel manuel ou d'un contact direct. Thibault ne relance pas, et ne propose pas de rappel groupé pour les autres dossiers.
- **Erreur à éviter** : cliquer « Relancer » ; écrire au Parquet que « le délai est dépassé par leur faute ».

### Situation 9 — Mail de statut JustInvoice inattendu
- **Situation** : mail du bureau de taxation : « Dossier 540112-26 – Changement de statut … a reçu le statut Demande d'information complémentaire ».
- **Question** : qu'a fait le robot et que fait Thibault ?
- **Bonne réponse** : le robot a noté le statut sur l'EDF et envoyé une notification « à vérifier sur JustInvoice », sans facture. Thibault retrouve l'EDF par son n° JustInvoice, résume ce qui est demandé (en lisant le portail via un humain si nécessaire) et remonte à Olivier le jour même ; si une correction de taxation suit : nouvel EDF + note de crédit, même n° JustInvoice.
- **Erreur à éviter** : créer la facture ; ignorer parce que « pas liquidation ».

### Situation 10 — Facture brouillon à contrôler
- **Situation** : liquidation reçue, facture brouillon créée au Parquet.
- **Question** : quels contrôles avant que le bureau la poste ?
- **Bonne réponse** : partenaire Parquet ; N° de commande exactement « ROJ-FJGK13 JINV<n° de dossier> » ; total identique à l'EDF taxé ; description avec n° EDF, PV, véhicule, période ; deux pièces jointes (EDF approuvé, réquisitoire) ; aucun rapport d'intervention. Puis le bureau poste, Peppol part ; Thibault guette un éventuel rejet dans fourriere@.
- **Erreur à éviter** : poster soi-même ; corriger le total pour « arrondir » ; ajouter les frais administratifs.

### Situation 11 — AVP présenté comme saisie
- **Situation** : fiche « Police – Saisie », réquisitoire administratif case « Abandon voie publique » rattaché ; un EDF était parti deux jours avant.
- **Question** : quelle suite ?
- **Bonne réponse** : la fiche est requalifiée AVP, le robot clôt le dossier et signale « EDF déjà parti — à régulariser ». Thibault prépare pour Olivier un brouillon d'annulation de l'EDF au destinataire, courtois, sans mention d'automatisme, et sans « à charge de la commune ». L'AVP suit son circuit (propriétaire ou épave, rien au Parquet).
- **Erreur à éviter** : laisser l'EDF courir ; envoyer un EDF suivant.

### Situation 12 — La nuit, un retour signé arrive
- **Situation** : 02 h 10, mail du Parquet avec trois EDF signés, sans texte négatif ; le robot est en envoi automatique.
- **Question** : que se passe-t-il et que fait Raphaël ?
- **Bonne réponse** : le robot rattache, marque validés et **dépose sur JustInvoice** dans la nuit si les trois pages sont reconnues. Raphaël ne touche à rien : il vérifie le lendemain matin, dans la passation, que les trois EDF ont un n° JustInvoice et qu'aucun suffixe n'a été mal lu ; s'il voit une anomalie, il la note pour 08:00.
- **Erreur à éviter** : relancer un dépôt manuel la nuit ; marquer à la main un EDF déjà traité.
