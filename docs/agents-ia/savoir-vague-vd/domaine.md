# Savoir de l'agent « Domaine » — SPF Finances, de la remise à la facture trimestrielle

> **Décisions d'Olivier du 04/10/2026 : voir [decisions-olivier.md](decisions-olivier.md). Elles priment sur les « à confirmer » de ce document.**

> Date de rédaction : **04/10/2026**
> Public : **Marion** (agente HOOS dédiée à Verviers Dépannage : remises au Domaine, Dates IN, ventes d'épaves, enlèvements, gardiennage à charge de l'État, facture trimestrielle). En lecture : **Thibault** (circuit Parquet, qui s'arrête là où commence le Domaine), **Raphaël** (fourrière de nuit), **Lucie** (fourrière). Les agents HOOS ne sont pas des employés de VD.
> Point de départ : `docs/agents-ia/fourriere.md` §2.8 (Lucie). Ce document le **complète** sans le recopier.
> Sources : code de VD Soft (`fichier:ligne`), migrations, mode d'emploi « Fourrière + Facturation » (fonctions 111 et 128), mémoire des décisions d'Olivier (**« Mobi »** ou **« IT »**, jamais « la direction »), comptages en lecture seule de la base au 04/10/2026.
> Convention : **« à confirmer »** = non tranché ou non vérifié. Aucune plaque ni aucun nom de particulier ; le contact du SPF Finances est désigné par sa fonction (son adresse est dans les réglages métier, « SPF Finances — Domaine »).

---

## 0. En une page

1. Le **Domaine** (SPF Finances, Services patrimoniaux) reçoit les **véhicules saisis** que la police décide de lui **remettre** quand le propriétaire ne se met pas en ordre. L'État les vend par soumission à une firme (épaviste) qui vient les enlever chez nous.
2. Trois dates gouvernent tout :
   - **Date IN** = date de **remise** au Domaine : fin de la période payée par le Parquet, début de la période payée par l'État ;
   - **date de vente** = date du mail « Vente d'épaves » ;
   - **Date OUT** = **date maximale d'enlèvement** fixée dans ce mail : fin de la période payée par l'État.
3. L'État paie **Date OUT − Date IN** jours (le jour de remise n'est pas compté, le jour d'enlèvement l'est), **au tarif gardiennage saisie** de chaque année (1,56 €/nuit voiture en 2026, tarif cyclo distinct), **sans frais administratifs**, sans prise en charge ni km.
4. Il n'y a **jamais d'état de frais au Domaine**. Le circuit est : **registre trimestriel** (« Vente d'épaves — Registre Domaine ») → envoyé à la gestionnaire du SPF Finances qui le **corrige et valide** → **une facture trimestrielle** à « SPF Finances » (partenaire n° 83), une ligne forfaitaire, registre Excel en annexe.
5. Deux robots lisent les mails du SPF dans fourriere@ (toute la boîte, car ces mails sont souvent classés dans un dossier « A traiter par Mobi ») : « **Dates IN** » et « **Vente d'épaves** ». Ils posent les dates, impriment les étiquettes **DOMAINE** et **VENDU DOMAINE**, et tiennent un registre fidèle au mail, même pour les véhicules qu'ils ne retrouvent pas.
6. L'écran **Domaine** est **réservé au superadministrateur**. Marion lit, contrôle, prépare ; un humain (Olivier) envoie, valide et facture.
7. Gros point d'attention au 04/10/2026 : **le 3e trimestre 2026 est clos depuis le 30/09** et **aucun n° de facture trimestrielle n'est enregistré dans VD Soft** pour 2026 (à vérifier dans le logiciel de facturation).

---

## 1. Les acteurs

| Acteur | Rôle | Canal | Source |
|---|---|---|---|
| **Police** | Décide la remise au Domaine ; dresse le **PV de remise** | Réquisitoire / PV, souvent par le SPF | mode d'emploi fonction 128 |
| **SPF Finances — Domaine** (gestionnaire du dossier) | Envoie les mails « Dates IN » et « Vente d'épaves » ; **valide le registre trimestriel** ; reçoit la facture | Réglage métier `mail_domaine_agent` ; mails vers fourriere@verviersdepannage.be | `src/lib/settings/business-registry.ts:34`, `src/lib/domaine/intake.ts:16-19` |
| **Firme acheteuse** (épaviste) | Achète par soumission ; enlève avant la Date OUT | Se présente au parc | `src/lib/domaine/parse-vente-epaves.ts:5-8` |
| **SPF Finances** (client de facturation n° 83) | Paie la facture trimestrielle ; peut fournir un **n° de bon de commande** | Logiciel de facturation | `business-registry.ts:23`, `src/lib/domaine/invoice-vente-epaves.ts:174-178` |
| **Parquet** | Payeur **jusqu'à** la Date IN (circuit de Thibault) | — | `docs/agents-ia/savoir-vague-vd/parquet.md` §3.10 e |

---

## 2. Le circuit de bout en bout

| # | Étape | Qui / quoi | Écran | Ce que Marion contrôle |
|---|---|---|---|---|
| 1 | Saisie au parc, circuit Parquet en cours | Thibault | États de frais | Fiche bien en source **Police – Saisie**, châssis complet |
| 2 | La police remet le véhicule au Domaine | Police → SPF | — | — |
| 3 | Mail « **Dates IN** » du SPF : date de remise + véhicules (marque, modèle, châssis, nom du PV de remise) | Robot Dates IN, lun-ven **13:00** heure belge | **Domaine → Dates IN (remises)** | Chaque ligne : « appliquée », « déjà posée », « non trouvé », « ambigu » |
| 4 | Date IN posée sur la fiche, **étiquette DOMAINE** imprimée | Robot | Fiche (encadré Saisie, pastille), Parc | Date IN ≥ date d'entrée au parc ; étiquette sortie |
| 5 | Le Parquet est facturé **jusqu'à la Date IN** (état de frais de clôture), puis plus rien | Robot Parquet | États de frais | Pas d'EDF après la Date IN ; erreur « Date IN antérieure à l'entrée » |
| 6 | Véhicule rangé en **zone I (Domaine)** | Bureau (hub QR « Envoyer au Domaine ») ou bouton « Préparation OK » | Hub QR, Plan du parc, registre | Zone I effective |
| 7 | Mail « **Vente d'épaves** » : firme, tableau des véhicules, date max d'enlèvement | Robot Vente d'épaves, lun-ven **13:30** heure belge | **Domaine** (registre) | Firme, Date OUT, lignes non rapprochées |
| 8 | Date de vente, firme, Date OUT posées ; **étiquette VENDU DOMAINE** | Robot | Registre, fiche | Étiquette sortie ; Date IN présente |
| 9 | Préparation du véhicule pour l'enlèvement | Bureau : « Préparation OK » | Registre | Zone I |
| 10 | Enlèvement par la firme | Bureau : **« Sortie réelle »** (par vente ou par ligne) | Registre | Fiche passée « à facturer » ; contrôle de sortie respecté |
| 11 | Fin de trimestre : registre exporté et envoyé au SPF pour validation | Humain (Olivier) | Registre → « Export Excel » | Total, lignes orange, Date OUT manquantes |
| 12 | Validation (corrections éventuelles) par le SPF | SPF | — | Écarts reportés dans le registre |
| 13 | **Facture trimestrielle** créée **et comptabilisée** (non envoyée) | Superadmin : « Facturer ce trimestre » | Registre | Total = registre validé ; n° de commande du SPF |
| 14 | Envoi de la facture depuis le logiciel de facturation | Humain | Logiciel de facturation | — |
| 15 | Fiches passées « Terminé » avec le n° de facture | Superadmin : « Passer les fiches en Terminé » | Registre | Places libérées au parc |

---

## 3. Le détail

### 3.1 Les écrans

- **Domaine** (« Domaine — Vente d'épaves », sous-titre « Vente d'épaves — Registre Domaine ») : accès **superadmin uniquement** (`src/app/fourriere/domaine/page.tsx:18`), aussi en onglet « Domaine » de l'écran **Sorties** pour le superadmin (`src/app/fourriere/sorties/page.tsx:25`). Ouverture = trimestre en cours + synchronisation automatique avec le parc (`src/app/fourriere/domaine/DomaineClient.tsx:60-66`).
  - Filtres : année, T1-T4, du / au (sur la **date de vente**).
  - Boutons : « Afficher », « Synchro parc » (censée re-rapprocher les lignes orphelines ; inopérante au 04/10/2026, voir §7 point 12), « Relire les mails », « Export Excel », et pour le superadmin « **Facturer ce trimestre** », champ « N° facture Odoo du trimestre » + « **Passer les fiches en Terminé** » (`DomaineClient.tsx:214-245`).
  - Tableau groupé par vente (« Vente d'épaves du … — N véhicules · Firme : … · Sortie réelle de la vente ») ; colonnes Réf, Véhicule, Châssis, Date IN, **Date OUT (modifiable)**, Jours, Frais, **Sortie réelle (modifiable)**, Prépa., Fiche ; lignes **orange** = non rapprochées à une fiche (mais **comptées**) ; lignes vertes = préparées (`DomaineClient.tsx:253-333`).
- **Dates IN (remises)** : lignes captées des mails, avec Date remise, Véhicule, PV de remise, Acheteur, Date vente, Date OUT, fiche liée ; boutons « Synchroniser les mails », réimprimer l'étiquette DOMAINE, transférer en zone I (`src/app/fourriere/domaine/dates-in/DatesInClient.tsx:107-182`).
- **Fiche → encadré « Saisie — gestion judiciaire » → « Domaine »** : saisie manuelle de la remise (date obligatoire, enlèvement et vente facultatifs, document ou commentaire) (mode d'emploi fonction 128 ; `src/app/api/missions/[id]/domaine/route.ts:44-60`).
- **Hub QR → « Envoyer au Domaine »** : **déplace seulement** le véhicule en zone I ; ne pose **aucune** date (`src/app/qr/mission/[id]/QrMissionClient.tsx:570-583`).
- **Vue dossier** : groupe « Domaine » (pseudo-groupe, jamais facturé depuis le dossier) ; canal de facturation « Domaine (relevé trimestriel) » (`docs/agents-ia/facturation.md:50-51`).

### 3.2 Les Dates IN (remises)

- Mail du SPF dont le sujet contient « Date IN » ou « Dates IN » (singulier accepté depuis un mail manqué le 03/09/2026), cherché **dans toute la boîte** fourriere@ (`intake.ts:20,56-65`).
- Format : blocs « JJ/MM/AAAA » suivis de lignes « Marque Modèle - n° de châssis : <châssis> (PV de remise <nom>) » (`src/lib/domaine/parse-dates-in.ts:3-7`).
- Rapprochement : **5 derniers caractères du châssis**, sur une fiche de source « saisie » non vendue, non archivée, non annulée (`intake.ts:98-104`).
  - **un seul résultat** : Date IN posée si la fiche n'en a pas, journal « Date de remise Domaine … posée automatiquement », **étiquette DOMAINE** (date de remise, véhicule, plaque, châssis, zone, PV, QR) envoyée à l'imprimante (`intake.ts:121-145`) ;
  - fiche avec Date IN déjà posée : « déjà posée », **sans comparer les dates** (`intake.ts:121`) ;
  - plusieurs résultats : « ambigu » ; aucun : « non trouvé ». Ces lignes sont **retentées** à chaque passage (`intake.ts:74-80`).
- Bornes : mails de **moins de 6 mois**, 6 mails et 20 dates posées par passage au plus (`intake.ts:29-31`). Passage lun-ven à 11:00 UTC (`vercel.json:22`), soit **13:00 heure belge** jusqu'au 25/10/2026, 12:00 ensuite.
- **Effet sur le Parquet** : le robot Parquet prend la Date IN comme coupe de l'état de frais de clôture, puis bascule le dossier au Domaine et n'émet plus rien (`src/lib/missions/saisie-cron.ts:187-193`, `src/lib/missions/saisie-dossier.ts:569-577`). L'estimation de prix de la fiche arrête aussi le gardiennage à la Date IN (`src/lib/missions/estimate-price.ts:1147-1158`).
- **Chiffres au 04/10/2026** : 73 lignes Dates IN captées : 43 appliquées, 7 déjà posées, **23 non trouvées**. Dernier passage le 02/10 : 24 lignes lues, 5 posées, 8 non trouvées.

### 3.3 La remise saisie à la main

- Fiche → « Domaine » : date de remise **obligatoire**, enlèvement et vente facultatifs, **document ou commentaire** obligatoire ; contrôles : enlèvement ≥ remise, vente ≥ enlèvement (`domaine/route.ts:44-63`).
- Effets : dates posées, **blocage police retiré** (`police_levee_saisie_ok`) (`domaine/route.ts:105-113`).
- ⚠️ Enregistrer à nouveau une remise **efface** une date d'enlèvement ou de vente déjà posée par le robot si les champs sont laissés vides (`domaine/route.ts:107-109`).
- ⚠️ **Aucun contrôle** que la date de remise est postérieure à l'entrée au parc : c'est le robot Parquet qui le détecte ensuite (« Date IN Domaine antérieure à l'entrée en parc — corriger la fiche », `saisie-cron.ts:178-183`). **5 fiches** étaient dans ce cas au passage du 04/10/2026.

### 3.4 La vente d'épaves

- Mail du SPF dont le sujet contient « épave(s) » (`src/lib/domaine/vente-epaves-intake.ts:21`) : « … vendu … à la firme <FIRME> les véhicules suivants » + tableau (N°, marque-modèle, châssis, date, adresse) + « La date maximale pour l'enlèvement a été fixée au JJ.MM.AAAA » (`parse-vente-epaves.ts:3-8`).
- Pour chaque véhicule rapproché (5 derniers du châssis ; à égalité, départage par la marque) (`vente-epaves-intake.ts:103-120`) :
  - **date de vente = date de réception du mail** (elle fait foi et corrige une valeur différente) ; firme, Date IN (colonne date du tableau) et Date OUT (date max d'enlèvement) posées **seulement si absentes** (`vente-epaves-intake.ts:131-142`) ;
  - **étiquette VENDU DOMAINE** (firme, « Enlèvement avant » = Date OUT, véhicule, plaque, châssis, zone, QR) uniquement pour une vente nouvelle (`:154-165`).
- **Toutes** les lignes du mail sont gardées dans le registre, rapprochées ou non (`src/lib/domaine/vente-epaves-register.ts:1-8`).
- Passage lun-ven à 11:30 UTC (`vercel.json:24`), soit **13:30 heure belge** jusqu'au 25/10/2026 ; mails de moins de 6 mois (`vente-epaves-intake.ts:30`).
- **Chiffres au 04/10/2026** : 150 lignes de vente sur 22 ventes et 9 firmes (T1 : 53, T2 : 50, T3 : 47) ; **132 non rapprochées** (essentiellement des véhicules de l'ancien logiciel de fourrière ou absents de VD Soft), 17 rapprochées, 1 ambiguë. Délai médian Date IN → vente : 20 jours ; vente → Date OUT : 10 jours (max 12). Sorties réelles posées : 141 ; préparées : 149.

### 3.5 Le calcul du gardiennage État

| Élément | Règle | Source |
|---|---|---|
| Date IN | Colonne date du mail de vente, sinon Date IN de la fiche | `vente-epaves-register.ts:79` |
| Date OUT | Valeur modifiée à la main dans le registre, sinon **date max d'enlèvement**, sinon date d'enlèvement de la fiche | `vente-epaves-register.ts:80` |
| Jours | **Date OUT − Date IN** (jour de remise non compté, jour d'enlèvement compté) ; découpage au 1er janvier, chaque année à son tarif | `vente-epaves-register.ts:83-95` |
| Tarif | Ligne « gardiennage (par jour) » de la grille **saisie** (pas « hors période ») ; tarif cyclo si « cyclo / moto / scooter / mobylette » dans marque-modèle ; tarif de l'année pris au 1er juin | `vente-epaves-register.ts:44-55`, `:81` |
| Pas de Date IN ou de Date OUT | 0 jour, 0 € (ligne visible, à compléter) | `vente-epaves-register.ts:83-85` |
| Sortie réelle | **Ne change pas** les jours facturés ; sert à sortir la fiche du parc | `src/app/api/fourriere/domaine/ventes-register/route.ts:7-9` |
| Trimestre | Selon la **date de vente** | `vente-epaves-register.ts:57-60` |
| Frais administratifs, prise en charge, km | **Jamais** | `src/lib/missions/saisie-billing.ts:169-173` |

**Exemple fictif** : remise le 10/03/2026, vente le 30/03, Date OUT le 09/04 → 30 jours × 1,56 € = 46,80 € HTVA pour l'État. Si la firme vient le 15/04, le registre reste à 30 jours (la Date OUT fait foi) ; si elle vient le 05/04, il reste aussi à 30 jours sauf correction manuelle de la Date OUT (décision humaine, à confirmer).

⚠️ Le mode d'emploi (fonction 128) parle des « jours entre la remise et la **vente** » : le calcul réel va de la remise à la **Date OUT** (date max d'enlèvement). C'est le code qui s'applique ; l'écart est à signaler.

### 3.6 Préparation, sortie, fin de vie de la fiche

- **« Préparation OK »** sur une ligne : note la préparation et **transfère la fiche en zone I** si elle est au parc ailleurs (`ventes-register/route.ts:179-201`).
- **« Sortie réelle »** (par vente, propagée à toutes ses lignes, ou par ligne) : si la ligne est rapprochée et la fiche encore active, la fiche passe **« à facturer »** avec un journal « Sortie réelle Domaine … → à facturer » (`ventes-register/route.ts:51-74,94-104`). Une fiche sous **contrôle de sortie** (expert passé) ne sort pas : remarque « Sortie Domaine … NON appliquée » (`:59-65`).
- **« Passer les fiches en Terminé »** avec le n° de la facture trimestrielle : les fiches rapprochées « à facturer » de la période passent « terminé », reçoivent le n° de facture et **libèrent leur place** ; le n° est mémorisé pour le trimestre (`ventes-register/route.ts:108-142`).
- Une épave ne se facture **jamais** au client, quelle que soit la porte de sortie (mémoire 16/09/2026).
- Saisies **historiques** (sans dossier Parquet) vendues au Domaine : archivées **sans facturation** ; seule la période Domaine va au registre (décision du 08/09/2026).
- **Au 04/10/2026** : 25 véhicules **au parc** ont une Date IN, dont **8 déjà vendus** (donc en attente d'enlèvement ou de « Sortie réelle » non posée).

### 3.7 La facture trimestrielle

- Bouton « **Facturer ce trimestre** » (superadmin) : demande le **n° de bon de commande (PO) du SPF** (facultatif), puis confirmation « Créer et comptabiliser la facture Domaine … La facture NE sera PAS envoyée » (`DomaineClient.tsx:140-155`).
- Ce que crée l'application (`invoice-vente-epaves.ts:36-88`) : une facture client à **SPF Finances (n° 83)**, journal des ventes, **une seule ligne** « [FORFAIT] Forfait — <N>ème trimestre <année> suivant tableau en annexe » = **total HTVA du registre**, TVA 21 %, référence = n° de PO si fourni ; **la facture est comptabilisée tout de suite** (pas un brouillon) ; le registre Excel du trimestre est joint. Modèle : facture de référence 2026/01/248.
- Refus si aucune vente sur la période, ou si le total est à 0 € (« Date OUT manquante ? ») (`invoice-vente-epaves.ts:45-46`).
- **Ordre impératif** : registre exporté → **validé par le SPF** → corrections reportées dans le registre (Date OUT) → facture → envoi depuis le logiciel de facturation → « Passer les fiches en Terminé ».
- Une facture comptabilisée ne se corrige que par **note de crédit** (humain).
- Le Domaine n'est **jamais relancé** pour un impayé (`docs/agents-ia/facturation.md:21,191`).

---

## 4. Règles fermes

1. **Pas d'état de frais au Domaine.** Le message « Destinataire Domaine non configuré » n'est pas un manque (décision du 21/09/2026).
2. **Le Parquet paie jusqu'à la Date IN, l'État de la Date IN à la Date OUT.** Aucun jour payé deux fois, aucun jour après la Date OUT.
3. **Tarif gardiennage saisie**, par année ; **jamais** de frais administratifs, de prise en charge ni de km à l'État.
4. **Facture trimestrielle seulement après validation du registre par le SPF.**
5. **Une ligne orange (non rapprochée) est comptée** : elle n'est jamais retirée du registre sans décision humaine.
6. **Ne jamais confondre** « Envoyer au Domaine » (déplacement en zone I) et **remise au Domaine** (Date IN).
7. Un véhicule remis au Domaine **appartient au circuit de l'État** : ne jamais conseiller de le rendre au propriétaire, de le détruire ou de le mettre en vente VD.
8. Mails sortants depuis **fourriere@verviersdepannage.be** ; ton courtois ; **ne jamais dévoiler l'automatisation** (« la date a été posée automatiquement » est interdit dans un texte au SPF).
9. Pas de rejeu des anciens mails ; on corrige pour le futur.
10. Jamais de suppression ; jamais de requalification de fiche ancienne sans le « go » d'Olivier.

---

## 5. Ce que Marion fait, ne fait jamais, remonte

### Fait (lecture, préparation, brouillons)
- Chaque jour ouvrable après 13:30 (heure belge), relit **Dates IN** et le **registre** : nouvelles lignes, « non trouvé », « ambigu », « déjà posée » à date différente.
- Pour chaque « non trouvé » : cherche la fiche par châssis partiel, marque, modèle dans la recherche fourrière, y compris les fiches anciennes ; propose au bureau le rapprochement ou la saisie manuelle de la remise, avec le mail en preuve.
- Contrôle Date IN ≥ date d'entrée au parc ; liste les erreurs signalées par le robot Parquet.
- Vérifie que l'étiquette DOMAINE / VENDU DOMAINE est sortie (sinon : réimpression à demander au bureau).
- Tient la liste des véhicules **vendus** encore au parc avec leur **Date OUT** : enlèvement imminent, dépassé, préparation faite ou non.
- En fin de trimestre : prépare le **registre** (lignes sans Date OUT, lignes orange, cyclos, cas à cheval sur deux années), un **brouillon** de mail d'envoi au SPF, et une note de contrôle pour Olivier (total, nombre de véhicules, écarts avec le trimestre précédent).
- Après validation du SPF : prépare la liste des corrections à reporter et le n° de PO à saisir.

### Ne fait jamais
- Envoyer le registre ou un mail au SPF, à la police, à une firme.
- Cliquer « Facturer ce trimestre », « Passer les fiches en Terminé », « Sortie réelle », « Préparation OK », « Envoyer au Domaine », ni modifier une Date OUT ou une remise.
- Ajouter des frais administratifs, une prise en charge ou des km à l'État ; facturer une épave au client.
- Retirer une ligne du registre, supprimer une fiche, requalifier une fiche ancienne.
- Rendre ou laisser rendre un véhicule remis au Domaine sans décision d'Olivier.

### Remonte
| Situation | À qui | Délai |
|---|---|---|
| Ligne « non trouvé » ou « ambigu » après recherche | Bureau fourrière (rapprochement) ; Olivier si fiche ancienne | Dans la journée |
| Date IN antérieure à l'entrée au parc, ou différente du mail sur une fiche « déjà posée » | Olivier | Dans la journée |
| Véhicule vendu non enlevé à la Date OUT | Bureau fourrière ; Olivier (contact SPF) | Le lendemain de la Date OUT |
| Propriétaire qui se présente pour un véhicule remis au Domaine | Olivier | Immédiat |
| Fin de trimestre : registre prêt pour envoi | Olivier | Dans les 5 jours ouvrables du trimestre suivant (à confirmer) |
| Réponse ou correction du SPF sur le registre | Olivier | Le jour même |
| Robot muet (aucune nouvelle ligne depuis longtemps alors que des mails arrivent), étiquette non imprimée | Olivier (IT) | Dès constat |

---

## 6. Travail de nuit (Raphaël, ou Marion la nuit)

- **Rien ne part la nuit.** Les robots Domaine ne tournent qu'en semaine, en début d'après-midi (`vercel.json:22,24`) : la nuit, aucune date n'est posée et aucune étiquette ne sort pour le Domaine.
- La nuit sert à préparer pour le matin : relevé des lignes orange, des Dates IN suspectes, des véhicules vendus dont la Date OUT tombe dans les 3 jours, brouillon du mail trimestriel si on est en début de trimestre.
- Si une firme se présente la nuit (cas rare) : Raphaël ne fait rien sortir sans la procédure de jour ; il note l'heure, la firme, le véhicule demandé, et le transmet à 08:00.
- Si un propriétaire appelle la nuit pour un véhicule remis au Domaine : réponse neutre (le dossier sera examiné par le service fourrière en journée), aucune information sur la vente ou l'acheteur.

---

## 7. Pièges connus (constatés au 04/10/2026)

1. **Fiches anciennes plus rapprochées** : depuis le **23/09/2026**, seule la source « Police – Saisie » porte le circuit saisie (migration `202609231000_saisie_scope_police_saisie_only.sql`), et les deux robots Domaine cherchent les fiches **par ce même critère** (`intake.ts:100`, `vente-epaves-intake.ts:105`). Une fiche reprise de l'ancien logiciel et non requalifiée ressort donc « **non trouvé** », alors que la mémoire du 29/07/2026 et le savoir de Lucie disent que ces fiches sont incluses. C'est probablement une partie des 23 + 132 lignes non rapprochées.
2. **Mails du SPF classés hors de la boîte de réception** : les robots cherchent dans toute la boîte, mais une recherche humaine doit aussi le faire.
3. **Mails de plus de 6 mois ignorés** par les robots (`intake.ts:29`, `vente-epaves-intake.ts:30`) : un rattrapage ancien est manuel.
4. **« Déjà posée » sans comparer les dates** : une Date IN fausse déjà présente n'est jamais corrigée par le mail.
5. **Date IN antérieure à l'entrée au parc** acceptée à la saisie manuelle et parfois issue de la colonne date du mail de vente : bloque l'état de frais de clôture (5 fiches le 04/10/2026).
6. **Ressaisir une remise à la main efface la vente et l'enlèvement** si les champs restent vides.
7. **« Envoyer au Domaine » (hub QR) ne pose aucune date.**
8. **La facture trimestrielle est comptabilisée immédiatement** (pas un brouillon, contrairement aux autres factures de VD Soft) : la moindre erreur = note de crédit.
9. **Date OUT = date max d'enlèvement, pas la sortie réelle** ; mode d'emploi en retard (« jusqu'à la vente »).
10. **Deux calculs coexistent** : le registre de l'écran et de la facture lit les lignes des mails ; un ancien calcul par fiches existe encore côté serveur (`src/lib/fourriere/domaine-billing.ts`, utilisé par l'adresse de lecture `/api/fourriere/domaine`). Le chiffre qui fait foi est celui de l'écran registre.
11. **Plaque absente** sur beaucoup de véhicules vendus : chercher par châssis.
12. **« Synchro parc » ne rapproche rien** : la liste des sources qu'elle utilise n'est jamais remplie (`src/lib/domaine/vente-epaves-parc-sync.ts:9,30` lit `SAISIE_SOURCES` de `vente-epaves-intake.ts:25`, qui reste vide). Le message « Synchro parc : à jour » ne prouve donc rien ; seul le robot de 13:30 (ou « Relire les mails ») rapproche. À signaler à Olivier.
13. **Écran figé après une mise à jour** : recharger deux fois.

---

## 8. À confirmer (questions précises pour Olivier)

1. Fiches anciennes (source « ancien logiciel ») : faut-il que les robots Dates IN et Vente d'épaves les cherchent de nouveau, malgré la règle du 23/09 (qui visait le circuit Parquet) ?
2. Factures trimestrielles 2026 : T1, T2 et T3 ont-ils été facturés au SPF Finances ? Aucun n° n'est mémorisé dans VD Soft. Faut-il reporter les n° pour passer les fiches en Terminé ?
3. Délai entre fin de trimestre et envoi du registre au SPF : quel est l'usage ?
4. Date OUT : si la firme enlève **après** la date maximale, qui paie les jours supplémentaires (État, firme, rien) ? Et **avant** : faut-il ramener la Date OUT à la sortie réelle ?
5. Qui envoie le registre au SPF et sous quel format (l'Excel exporté tel quel ?) ; faut-il un modèle de mail ?
6. Véhicule remis au Domaine réclamé par son propriétaire (levée tardive) : la mémoire prévoit une note de crédit au Domaine et une refacturation au client (avec frais administratifs) ; rien n'est construit. Procédure manuelle à suivre ?
7. La saisie manuelle d'une remise lève le blocage police : est-ce voulu, alors que le véhicule appartient alors à l'État ?
8. Lignes non rapprochées (véhicules hors VD Soft) : toujours facturées à l'État telles quelles, même sans fiche ?
9. Faut-il un contrôle automatique « Date IN ≥ entrée au parc » à la saisie manuelle ?
10. Marion peut-elle avoir un accès en lecture à l'écran Domaine (aujourd'hui superadmin seulement), ou travaille-t-elle uniquement sur exports ?

---

## 9. Situations d'examen

> Données fictives.

### Situation 1 — Mail Dates IN, un véhicule non trouvé
- **Situation** : le mail du SPF liste 6 véhicules remis le 22/09 ; l'écran Dates IN montre 5 « appliquées » et 1 « non trouvé » (châssis se terminant par 31796).
- **Question** : que fait Marion ?
- **Bonne réponse** : elle cherche par châssis partiel, marque et modèle, y compris parmi les fiches de l'ancien logiciel. Si elle trouve une fiche ancienne non requalifiée, elle explique au bureau et à Olivier que le robot ne la voit plus depuis le 23/09 ; la remise se fait alors à la main (fiche → Domaine, date 22/09, mail en document) après décision de requalification par Olivier. Si rien n'existe, la ligne est signalée (véhicule jamais encodé).
- **Erreur à éviter** : ignorer la ligne ; poser la date sur une fiche au hasard d'un châssis voisin.

### Situation 2 — Date IN avant l'entrée au parc
- **Situation** : le robot Parquet signale « Date IN Domaine (17/06) antérieure à l'entrée en parc (01/07) ».
- **Question** : quelle conséquence et quelle action ?
- **Bonne réponse** : l'état de frais de clôture du Parquet est bloqué ; le véhicule reste ni facturé au Parquet ni correctement dans le registre. Marion compare le mail Dates IN et la fiche (date d'entrée erronée ? mauvaise fiche rapprochée ? date de la colonne du mail de vente ?), puis remonte à Olivier avec les deux dates et la preuve.
- **Erreur à éviter** : corriger elle-même une des deux dates.

### Situation 3 — Calcul de l'État
- **Situation** : remise le 15/12/2025, vente le 08/01/2026, date max d'enlèvement le 20/01/2026, voiture.
- **Question** : combien de jours et quel tarif ?
- **Bonne réponse** : 36 jours (Date OUT − Date IN), coupés au 1er janvier tel que le registre le calcule : 17 jours sur 2025 (du 15/12 au 01/01) au tarif saisie 2025 (1,53 €) et 19 jours sur 2026 (du 01/01 au 20/01) au tarif 2026 (1,56 €), soit 26,01 + 29,64 = 55,65 € HTVA ; trimestre de facturation : T1 2026 (date de vente). Aucun frais administratif.
- **Erreur à éviter** : compter jusqu'à la vente ; appliquer 20 €/nuit ; compter le jour de remise.

### Situation 4 — « Envoyer au Domaine » sans remise
- **Situation** : un collègue a utilisé « Envoyer au Domaine » sur le hub QR d'une saisie ; aucun mail Dates IN ne la mentionne.
- **Question** : le Parquet est-il arrêté ?
- **Bonne réponse** : non. Ce bouton a seulement déplacé le véhicule en zone I. Sans Date IN, le Parquet continue d'être facturé tous les 2 mois. Marion le signale : soit la remise est réelle et il faut le document (mail du SPF, PV), soit le véhicule n'aurait pas dû bouger.
- **Erreur à éviter** : considérer le véhicule comme remis au Domaine.

### Situation 5 — Firme en retard
- **Situation** : vente du 10/09 à la firme X, date max d'enlèvement 22/09 ; au 04/10 le véhicule est toujours au parc, marqué « Préparation OK ».
- **Question** : que fait Marion et que devient le gardiennage ?
- **Bonne réponse** : le registre s'arrête à la Date OUT (22/09). Marion remonte au bureau et à Olivier (contact SPF / firme) ; la prise en charge des jours après le 22/09 est une décision humaine (à confirmer). Elle n'allonge pas la Date OUT.
- **Erreur à éviter** : modifier la Date OUT ; facturer la firme ou le Parquet.

### Situation 6 — Fin de trimestre
- **Situation** : nous sommes le 04/10/2026. T3 2026 contient 47 lignes de vente.
- **Question** : comment Marion prépare-t-elle la facture ?
- **Bonne réponse** : elle vérifie qu'aucune ligne n'a 0 jour (Date OUT manquante), relit les lignes orange (comptées), les cyclos, les châssis ; prépare un brouillon de mail d'envoi du registre (export Excel) pour Olivier ; après la validation du SPF, liste les corrections et le n° de PO. Olivier crée la facture (« Facturer ce trimestre » : comptabilisée, non envoyée), l'envoie, puis passe les fiches en Terminé avec le n°. Elle signale aussi qu'aucun n° de facture n'est mémorisé pour 2026 (question 2).
- **Erreur à éviter** : facturer avant validation ; retirer les lignes orange ; croire que la facture est un brouillon modifiable.

### Situation 7 — Propriétaire qui se présente
- **Situation** : un propriétaire arrive avec une levée de saisie pour un véhicule remis au Domaine le mois dernier, non encore vendu.
- **Question** : que dit et fait l'agent ?
- **Bonne réponse** : rien n'est rendu sans Olivier : le véhicule relève de l'État depuis la remise. L'agent prépare les faits (Date IN, document de levée, état de la vente) et transmet immédiatement. La procédure de reprise (note de crédit éventuelle, refacturation au client avec frais administratifs) est à confirmer.
- **Erreur à éviter** : lancer la restitution parce que le blocage police est levé sur la fiche.

### Situation 8 — Mail introuvable
- **Situation** : le SPF dit avoir envoyé une vente d'épaves la semaine passée ; le registre ne la montre pas.
- **Question** : où chercher ?
- **Bonne réponse** : dans **toute** la boîte fourriere@, dont le dossier « A traiter par Mobi » ; vérifier que l'objet contient « épave(s) » et que l'expéditeur est bien l'adresse du réglage ; si le mail existe, demander une relecture des mails (bouton « Relire les mails », humain) ou remonter à Olivier si l'expéditeur a changé.
- **Erreur à éviter** : conclure que le SPF ne l'a pas envoyé ; transférer le mail ailleurs.

### Situation 9 — Ligne « déjà posée » à date différente
- **Situation** : le mail Dates IN donne une remise au 05/08 ; la fiche porte déjà une Date IN au 01/08 saisie à la main.
- **Question** : quelle date vaut ?
- **Bonne réponse** : le robot n'a rien changé (« déjà posée »). Le mail du SPF est la preuve officielle ; Marion remonte l'écart à Olivier avec les deux sources ; si la date change, l'état de frais de clôture du Parquet et le registre doivent être revus (Thibault prévenu).
- **Erreur à éviter** : laisser l'écart ; modifier la fiche soi-même.

### Situation 10 — Le Parquet reçoit encore des états de frais
- **Situation** : une saisie remise au Domaine le 15/07 reçoit un état de frais Parquet « gardiennage jusqu'au 30/09 ».
- **Question** : où est l'erreur ?
- **Bonne réponse** : la Date IN n'était pas sur la fiche au moment du passage du robot (mail non trouvé, ou remise saisie après). Marion et Thibault préparent pour Olivier : l'état de frais à annuler pour la période après le 15/07, la Date IN à poser, et le registre à compléter.
- **Erreur à éviter** : facturer le même jour au Parquet et à l'État.

### Situation 11 — Épave sans plaque, la nuit
- **Situation** : 23 h, un épaviste appelle pour enlever « demain 6 h » trois véhicules d'une vente Domaine.
- **Question** : que fait Raphaël ?
- **Bonne réponse** : il ne promet rien et ne fait rien sortir ; il note la firme, la vente, les véhicules et l'heure demandée, vérifie en lecture que la vente existe dans le registre et que la Date OUT n'est pas dépassée, et met l'information en tête de la passation de 08:00. La sortie se fait de jour avec « Sortie réelle » et le contrôle de sortie si un expert est passé.
- **Erreur à éviter** : organiser l'enlèvement la nuit ; confirmer par mail à la firme.
