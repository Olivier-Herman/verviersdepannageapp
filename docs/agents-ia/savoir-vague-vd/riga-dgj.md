# Savoir des agents « Dépannage Riga » et « DGJ VHU » — groupe Verviers Dépannage

> **Décisions d'Olivier du 04/10/2026 : voir [decisions-olivier.md](decisions-olivier.md). Elles priment sur les « à confirmer » de ce document.**

> Date de rédaction : **04/10/2026**
> Public : agents IA de **HOOS** dédiés au groupe Verviers Dépannage — **Rémi** (Dépannage Riga : ventes, achats, banque dans l'ERP), **Justine** (Dépannage Riga : veille du dossier « Dépannage Riga » dans info@ et administration@), **Gaëtan** (DGJ VHU : agent général). Ce ne sont pas des employés du groupe.
> Sources : lecture seule de l'ERP (Odoo multi-sociétés) le 04/10/2026, code de VD Soft (connecteur ERP, agent mail, courrier, paie), mémoire des décisions d'Olivier (compte **« Mobi »**, IT — jamais « la direction »).
> Convention : **« à confirmer »** = non tranché ou non vérifié. Aucun nom de particulier ; les fournisseurs sont cités par catégorie, ou par nom de société quand c'est utile au travail.
> À lire avec : `equipe.md`, `facturation.md`, `rappels-clients.md`.

---

## 0. En une page

- Le groupe tient **trois sociétés dans un seul ERP** (« multi-sociétés ») :

| N° société dans l'ERP | Société | TVA | Agent |
|---|---|---|---|
| **1** | Verviers Dépannage (VD) | BE0460759205 | (agents VD) |
| **2** | **Dépannage Riga** (SRL) | BE0890464750 | **Rémi** (ERP), **Justine** (mails) |
| **3** | **DGJ VHU** (SRL) | BE0731879153 | **Gaëtan** |

- **Dépannage Riga** porte la **flotte de camions** et des **biens immobiliers / financements** ; elle **loue ses camions à Verviers Dépannage** (13 factures de location le 1er de chaque mois). Son activité réelle = achats d'entretien de poids lourds, assurances, taxes, crédits, et la refacturation à VD.
- **DGJ VHU** est un **centre de véhicules hors d'usage** (VHU) ; elle facture à VD une **prestation de gérance mensuelle** ; elle a du personnel (paie séparée). L'ERP de la société 3 **n'est pas lisible** par le compte technique actuel.
- **Piège n°1** : le connecteur ERP de VD Soft est **verrouillé sur la société 1**. Une recherche « classique » sur Riga ou DGJ renvoie **zéro** → ne **jamais** conclure « rien dans l'ERP » pour Riga ou DGJ.
- **Cloisonnement strict** : une pièce de Riga ne va jamais dans VD, ni l'inverse ; chaque société a ses journaux, ses comptes bancaires, sa boîte d'encodage des achats.
- La **comptabilité est tenue chez le comptable externe** (cabinet THG, Malmedy). L'ERP sert à **solder et lettrer** les factures, pas à tenir les livres.
- Les agents **lisent et préparent** ; ils ne valident, ne paient, ne lettrent, n'envoient et ne suppriment rien sans le « oui » d'une personne (Mobi pour Riga et DGJ).

---

## 1. Dépannage Riga (société 2)

### 1.1 Ce que fait la société (constaté dans l'ERP)

**Ventes** (journal « Sales », code **FAC**) :
- **Client quasi unique : Verviers Dépannage** (216 factures et notes de crédit sur 217).
- Chaque **1er du mois**, **13 factures « [LOC] Location »** : camions (DAF, Scania, Volvo FL6, Iveco Daily, Mercedes Atego), une Mercedes Vito, une remorque. Montants HTVA par véhicule : 300 €, 1 500 €, 2 850 €, 3 500 €, 5 500 €. **Total : 40 350 € HTVA / 48 823,50 € TVAC par mois**, stable depuis mars 2026.
- Volumes : 2025 = 60 factures (242 168,73 € TVAC) ; 2026 au 04/10 = 143 factures (532 898,48 € TVAC).
- Une seule vente hors groupe (un forfait de 27 272,73 € à une personne privée) : nature **à confirmer** (vente d'un véhicule ?).
- **Factures Riga → VD non payées : 67, reste dû 277 258,73 €.** Côté VD, 53 factures fournisseur Riga « non payées » pour 201 162,50 € → **écart à confirmer** (pièces pas encore encodées chez VD ? paiements non lettrés ?).

**Achats** (journal « Purchases », code **FACTU**) :
- 524 factures fournisseurs, 35 notes de crédit, 15 tickets. Rythme 2025-2026 : **30 à 60 factures par mois** (21 000 € à 168 000 € TVAC selon le mois ; pics en décembre 2025, juillet et septembre 2026).
- Catégories de fournisseurs : **entretien et pièces de poids lourds** (garages camions, freins, hydraulique, pièces), pneus, carrosserie et nettoyage, **assurances** (via le courtier RGF : TVM, MSIG, Vivium = P&V), **taxes** (SPW – taxe de circulation), énergie et eau, télécom, alarme, **organismes de crédit** (ING), **travaux de construction** (architecte, entreprise de construction — chantier **à confirmer**).
- Presque toutes les lignes sont sur le compte par défaut « Raw Materials » : **normal** (la compta est refaite chez THG) — ne pas ouvrir de débat là-dessus.
- Au 04/10/2026 : 23 factures comptabilisées non payées (54 466,83 €) et **15 brouillons** (12 382,66 €), dont des **doublons probables** (même montant créé 2 ou 3 fois, parfois sur le mauvais fournisseur, voire sur « Verviers Dépannage » comme fournisseur).

**Banque** (2 comptes ING) :
- **BNK2 = BE02 3630 1755 7040** : compte courant (40 à 110 lignes par mois) — paiements fournisseurs, domiciliations (énergie, financements de véhicules), remboursements de crédits (terrain/immeuble, véhicules, revolving), frais et intérêts, paiements Bancontact, **apports de VD** par virements instantanés ronds (6 000 €, 10 000 €, 20 000 €, 30 000 €).
- **BNK1 = BE53 3631 4258 1653** : compte secondaire (8 à 30 lignes par mois) — petits virements entrants récurrents de particuliers (500 à 625 € : **loyers probables, à confirmer**), virements internes Riga ↔ Riga.
- Lettrage 2026 : 639 lignes lettrées, **44 non lettrées** (dont les apports de VD et un versement d'assurance de 9 000 € du 25/09).
- Autres journaux : Caisse (CSH1), Opérations diverses (OD, OD1), TVA, différences de change, valorisation des stocks.
- Flux vers DGJ VHU : virements réguliers de Riga vers DGJ (13 500 € plusieurs mois, 11 935 €, 4 400 €, 1 000 €) — **nature à confirmer** (gérance ? personnel ?).

**Courrier et mails** : l'alias d'encodage des achats Riga est **purchases-depannage-riga@** (domaine de l'ERP). Les avis d'assurance (TVM, MSIG via RGF), les rappels de fournisseurs et les questions du comptable arrivent sur **info@** et/ou **administration@**.

### 1.2 Le dossier « Dépannage Riga » de septembre 2026 (contexte pour Justine)

- Le **15/09/2026**, le comptable (THG) a envoyé l'état des comptes fournisseurs de Riga au 31/08, annoté (double paiement, facture manquante, impayé).
- Le **27/09**, l'analyse a été faite dans l'ERP (société 2) et des mails sont partis depuis administration@ (réponse au comptable, courtier RGF, SPW Fiscalité, un fournisseur de freins, un contrôle technique). Le mail au fournisseur Eggo n'est **pas** parti.
- Le **28-29/09**, réponses reçues : RGF (avis TVM et Vivium réglés, **Vivium S2 17,24 € à payer**, **écart TVM 2,99 € à confirmer**), décomptes du sinistre du camion (3 versements TVM : 69 115,00 € le 24/06, 43 811,24 € le 07/07, **9 000 € le 25/09, non lettré**).
- Restent ouverts (au 29/09) : écart 2,99 €, Vivium 17,24 €, Eggo, plusieurs postes sans contact mail (traitement par téléphone ou en interne : Mobi).
- Un rappel d'un distributeur d'eau reçu le 28/09 visait **un contrat qui n'est ni Riga ni VD** : hors dossier → signalé, pas de brouillon. Exemple type de piège.

### 1.3 Rémi — ce qu'il fait dans l'ERP (société 2)

| Tâche | Ce que Rémi fait | Ce qu'il ne fait pas |
|---|---|---|
| **Ventes** | Vérifie le 1er du mois que les **13 factures de location** sont créées, avec le bon véhicule, la bonne période et le bon montant ; signale un châssis vide ou en double (au 01/10/2026 : 4 factures sans châssis, un même châssis Atego sur 2 factures). | Créer, valider ou annuler une facture sans accord de Mobi ; changer un tarif de location. |
| **Achats** | Contrôle les brouillons arrivés par l'alias d'encodage : bon fournisseur, bon numéro, bon montant, bonne société (TVA du destinataire = BE0890464750), **doublons**. Prépare la liste « à valider / à supprimer » pour Mobi. | Valider (comptabiliser), supprimer un brouillon, modifier une facture validée. |
| **Banque** | Propose le rapprochement ligne bancaire ↔ facture (« une ligne par document »), repère les lignes non lettrées et leur cause probable. | Lettrer, délettrer, créer une écriture, payer. |
| **Comptable** | Prépare les pièces et les réponses aux questions de THG (relevé, preuve de paiement, facture manquante). | Envoyer au comptable : c'est Mobi qui envoie. |

### 1.4 Justine — veille du dossier « Dépannage Riga » dans info@ et administration@

- **Quoi surveiller** : mails des fournisseurs de Riga, du courtier RGF, de l'assureur TVM/MSIG/Vivium, du SPW, du comptable THG (quand il parle de Riga), de la banque ING pour Riga ; rappels de paiement adressés à « Dépannage Riga » ou à la TVA BE0890464750.
- **Comment reconnaître Riga** : **la TVA du destinataire fait foi**, sinon le nom « Riga ». Une adresse ou un nom de particulier proche ne suffit pas (cas du distributeur d'eau).
- **Exclure** : réponses automatiques d'absence, mails d'assistances (ce ne sont jamais des factures fournisseurs), mails VD ou DGJ.
- **À chaque mail utile** : le lire, rapprocher de l'ERP (société 2, en lecture), résumer ce qui change (réglé / à payer / écart), préparer **un brouillon dans le fil** (jamais envoyé sans accord), et noter l'état du dossier.
- **Boîte d'envoi** : les envois administratifs et comptables partent d'**administration@** ; une **réponse à un mail reçu sur info@** se prépare **dans le fil, depuis info@** (règle du 30/09/2026). En cas de doute : demander.
- **Pas de doublon de veille** : une seule veille active à la fois (si Mobi relance une ancienne relève, s'aligner sur le dernier mail traité).

---

## 2. DGJ VHU (société 3)

### 2.1 Ce que l'on sait

- **Centre de véhicules hors d'usage** (VHU) : dépollution, démontage, destruction de véhicules (source : description de la société dans le module Courrier de VD Soft).
- Établie à Pepinster (rue de Lefin, même site que VD, d'après les virements).
- **Facture à Verviers Dépannage une « Prestation gérance » de 5 000 € HTVA (6 050 € TVAC) par mois** ; VD paie par virement (parfois deux mois d'un coup). Au 04/10/2026, côté VD : 11 factures DGJ payées, **2 non payées (12 100 €)**.
- **Reçoit aussi des virements de Riga** (voir §1.1, nature à confirmer).
- A **du personnel** : sa paie arrive chaque mois dans info@ (« DGJ VHU SRL (3068) Traitement mensuel ») ; contrairement à VD, ses fiches de paie **ne sont pas** poussées dans l'ERP (aucun journal de paie DGJ créé).
- **Axel Dépannage SRL** (sans activité) appartient au groupe DGJ VHU (source : `equipe.md`).
- L'alias d'encodage des achats DGJ est **purchases-dgj.vhu@** (domaine de l'ERP). Le 23/09/2026, 1 facture DGJ a été transférée par l'agent mail.
- **Accès** : le compte technique de VD Soft voit les sociétés 1 et 2, **pas la 3**. Aucune donnée DGJ n'a pu être lue dans l'ERP pour ce document. Gaëtan aura besoin d'un **accès dédié** (décision de Mobi).

### 2.2 Gaëtan — agent général DGJ VHU

- **Courrier et mails** : reconnaître ce qui est adressé à DGJ VHU (TVA BE0731879153), résumer, classer, préparer un brouillon ; factures fournisseurs → transfert vers l'alias d'encodage DGJ, **après avoir vérifié** qu'elles ne sont pas déjà encodées (voir piège §3.2).
- **ERP société 3** (quand l'accès existera) : mêmes gestes que Rémi (contrôle des brouillons, rapprochement bancaire proposé, préparation pour le comptable), en lecture et proposition.
- **Lien avec VD Soft** : les demandes de transport « VHU » (onglet VHU du dispatch, source « Car Parts & Recycling », jamais facturées, validées d'office) et l'épaviste des dossiers de destruction (« Car Parts & Recycling ») concernent la filière VHU. **À confirmer** : Car Parts & Recycling est-il le nom commercial de DGJ VHU ou une autre société ? (Le 23/09, des factures adressées à « Car Parts » ont été classées **hors des trois sociétés**.)
- **Paie** : peut préparer la lecture du mail mensuel de paie DGJ ; ne pousse rien dans l'ERP.

---

## 3. Pièges multi-sociétés

### 3.1 Le connecteur de VD Soft est verrouillé sur Verviers Dépannage
- Tout appel ERP de VD Soft passe par défaut **dans la société 1** : le contexte de société est **imposé** à 1, et un contexte passé à la main est **ignoré**.
- Pour lire Riga ou DGJ, VD Soft doit **le demander explicitement** (paramètre de société dédié). Constat du 04/10/2026 : la même recherche des factures fournisseurs de Riga renvoie **0** dans le contexte de la société 1 et **524** dans le contexte de la société 2.
- Le **27/09/2026**, un agent a affirmé à tort « Riga n'est pas dans l'ERP » et proposé d'en créer la compta. Olivier : « Tout Riga est dans Odoo. Il est en multi-company, il faut regarder sur la société id 2. »
- **Règle** : avant toute phrase « rien dans l'ERP » pour Riga ou DGJ, vérifier la société de la recherche.

### 3.2 Conséquence probable sur l'agent mail (à signaler à Mobi)
- L'agent mail vérifie « cette facture fournisseur est-elle déjà dans l'ERP ? » **par société**, mais via le connecteur verrouillé sur la société 1. Pour Riga et DGJ, la vérification renvoie donc **toujours « absente »** → la facture est **transférée pour encodage même si elle existe déjà**.
- Indices concordants : brouillons Riga en double ou en triple au 01/10/2026 ; un doublon d'une facture déjà payée créé le 23/09. **À confirmer et à corriger par Mobi** (les agents ne modifient pas le logiciel).
- En attendant : avant de transférer une facture Riga/DGJ, **vérifier soi-même** dans la bonne société (lecture) et, en cas de doublon, ne rien transférer.

### 3.3 Les relances clients ne concernent que VD
- Le module « Relances clients » ne lit que la société Verviers Dépannage. Riga et DGJ **n'ont pas de relance client** (leur client est VD). Une facture **VD → Riga** (mai 2026, 831,40 €) apparaît pourtant dans la liste VD : **ne jamais relancer une société sœur**.

### 3.4 Flux entre sociétés
- **Riga → VD** : locations de camions (mensuel), refacturations ponctuelles (dégâts chauffeur…).
- **DGJ → VD** : gérance (mensuel).
- **VD → Riga** : apports de trésorerie (virements ronds, souvent non lettrés), refacturations ponctuelles (ex. dépannage d'un camion Riga).
- **Riga → DGJ** : virements réguliers (nature à confirmer).
- Ces flux se **lettrent dans chaque société**, pièce par pièce. Un paiement global de VD ne se « répartit » pas au jugé : on propose, Mobi décide.

### 3.5 Autres pièges
- **Banque** : un même virement apparaît dans deux sociétés (sortie chez l'une, entrée chez l'autre). Ne jamais lettrer une ligne de la société 2 avec une facture de la société 1.
- **Fournisseurs partagés** : un même fournisseur (pièces, freins, assurances) facture parfois VD et Riga. **La TVA du destinataire** décide, pas le nom du fournisseur.
- **Amendes** : le module Amendes de VD Soft crée les factures dans la société 1 (VD). Une amende liée à un camion de Riga a aussi été payée par Riga (transaction parquet de police, 455,88 €). **À confirmer** : quelle société paie l'amende d'un camion Riga conduit par un chauffeur VD ?
- **Odoo 19** : le champ « mobile » n'existe plus sur les fiches contacts ; auditer les champs avant toute lecture automatisée.
- **Mots** : ne pas écrire « Odoo » dans un texte destiné à un utilisateur ou un tiers ; dire « l'ERP » ou « notre facturation ».

---

## 4. Règles fermes

1. **Cloisonnement** : chaque pièce dans **sa** société (la TVA du destinataire fait foi). Jamais une pièce Riga ou DGJ dans VD, ni l'inverse.
2. **Lecture et proposition seulement** : pas de validation, paiement, lettrage, suppression, modification de facture validée, sans le « oui » de Mobi.
3. **Jamais supprimer** une ligne d'un bon de commande confirmé ni une pièce ; un doublon se signale.
4. **Ne jamais conclure « vide »** sans avoir vérifié la société (piège du verrou société 1).
5. **La compta est chez THG** : on ne débat pas du compte d'imputation ou de la TVA déductible ; le critère est « la facture se solde, la ligne bancaire se lettre, une fois et une seule ».
6. **Jamais d'envoi à un tiers** (comptable, fournisseur, courtier, banque) : des brouillons, dans la bonne boîte (administration@ pour les envois ; info@ pour répondre à un mail reçu sur info@).
7. **Ne pas dévoiler l'automatisation** dans un mail à un tiers.
8. **Pas de données privées** dans les comptes rendus (locataires, salariés, particuliers) : catégories et montants seulement.
9. **Jamais de relance client** entre sociétés du groupe.
10. **Pas de « la direction »** : Olivier = « Mobi » ou « IT ». Engagement d'une société (contrat, convention, crédit) = **Axel** (**à confirmer** pour Riga et DGJ : qui signe ?).

---

## 5. Ce qui remonte, et à qui

| Sujet | À qui |
|---|---|
| Valider / supprimer un brouillon, payer, lettrer, répondre au comptable | **Mobi** |
| Doublons d'encodage dus à l'agent mail, accès ERP société 3, défaut du connecteur | **Mobi (IT)** |
| Questions du comptable THG sur Riga ou DGJ | Préparées par Rémi/Justine/Gaëtan, envoyées par **Mobi** |
| Contrat de location, crédit, assurance, engagement d'une société | **Axel** (**à confirmer**) |
| Personnel DGJ (paie) | **Mobi** (et le secrétariat social) |

---

## 6. À confirmer (questions précises pour Olivier)

1. **Riga → VD** : écart entre 277 258,73 € dus selon Riga (67 factures) et 201 162,50 € non payés selon VD (53 factures) — pièces non encodées chez VD, ou apports de VD non lettrés ?
2. Les **apports de VD vers Riga** (virements ronds) doivent-ils être lettrés avec les factures de location ? Selon quelle règle (les plus anciennes d'abord ?)
3. Les **virements entrants de 500 à 625 €** sur le compte BNK1 de Riga sont-ils des **loyers** ? Riga a-t-elle une activité immobilière (bâtiments à Lefin) ?
4. **Travaux de construction** payés par Riga (architecte, entreprise de construction, financement terrain/immeuble) : quel chantier ?
5. **Vente à 27 272,73 €** en 2026 : vente d'un véhicule de Riga ?
6. **Riga → DGJ** (13 500 € par mois environ) : quelle prestation ? DGJ facture-t-elle aussi une gérance à Riga ?
7. **DGJ VHU** : quel accès donner à Gaëtan dans l'ERP (société 3) ? Journaux, comptes bancaires, alias d'achats actifs ? Volume réel ?
8. **Car Parts & Recycling** : nom commercial de DGJ VHU, ou société distincte ?
9. **Qui signe** pour Riga et pour DGJ VHU (Axel ?) ; qui valide les achats de Riga au quotidien (Mobi seul ?).
10. Factures de location du 01/10/2026 : 4 sans numéro de châssis et un même châssis sur 2 factures (Atego) — erreur de saisie ou deux véhicules ?
11. Le module Amendes doit-il distinguer la société propriétaire du camion (VD ou Riga) ?
12. La correction du contrôle « déjà encodée ? » de l'agent mail pour Riga/DGJ (piège §3.2) : à planifier ?

---

## 7. Situations d'examen

### Situation 1 — « Riga est vide »
- **Situation** : un outil de VD Soft répond « aucune facture fournisseur trouvée pour Dépannage Riga ».
- **Bonne réponse** : l'outil cherche dans la société 1. Refaire la lecture **dans la société 2** (524 factures fournisseurs au 04/10/2026). Ne jamais proposer de « créer la compta de Riga ».
- **Erreur à éviter** : répondre à Mobi « Riga n'est pas dans l'ERP ».

### Situation 2 — Facture fournisseur reçue sur info@
- **Situation** : une facture d'un garage camions arrive sur info@, adressée à « Dépannage Riga SRL – BE0890464750 ».
- **Bonne réponse** : Justine identifie Riga par la TVA ; Rémi vérifie **dans la société 2** si elle est déjà encodée (numéro, puis fournisseur + montant). Si oui : on classe, rien à transférer. Sinon : transfert vers l'alias d'encodage de Riga (après accord si la règle l'exige) et contrôle du brouillon créé.
- **Erreur à éviter** : se fier au contrôle automatique « absente de l'ERP » (faussé pour Riga) et créer un doublon ; l'encoder dans VD.

### Situation 3 — Brouillons en triple
- **Situation** : Rémi voit trois brouillons de 1 479,94 € créés le 01/10 : deux sur le fournisseur de freins, un sur « Verviers Dépannage ».
- **Bonne réponse** : signaler à Mobi un doublon probable (une seule facture réelle), en indiquant lequel garder (bon fournisseur, bon numéro, pièce jointe) ; lister la cause probable (transfert multiple / contrôle faussé).
- **Erreur à éviter** : supprimer les brouillons ou en valider un soi-même.

### Situation 4 — Les locations du mois
- **Situation** : le 01/11, Rémi doit contrôler les factures de location Riga → VD.
- **Bonne réponse** : 13 factures attendues, total 40 350 € HTVA / 48 823,50 € TVAC, période du mois en cours, un véhicule par facture avec son châssis ; signaler tout écart (facture manquante, châssis vide ou en double, montant différent).
- **Erreur à éviter** : créer une facture manquante ou corriger un montant sans Mobi ; relancer VD comme un client.

### Situation 5 — Un virement de VD de 20 000 €
- **Situation** : sur le compte BE02 de Riga, un virement instantané de 20 000 € de Verviers Dépannage, non lettré.
- **Bonne réponse** : proposer à Mobi les factures de location Riga → VD qu'il pourrait solder (les plus anciennes, montant exact ou partiel), en rappelant que la règle n'est pas encore fixée (à confirmer) ; rappeler que la sortie correspondante côté VD doit être lettrée **dans la société 1**.
- **Erreur à éviter** : lettrer soi-même ; lettrer une ligne Riga avec une facture VD.

### Situation 6 — Mail du comptable sur Riga et VD
- **Situation** : THG écrit à Mobi (copie info@) avec 3 questions sur Riga et 4 sur VD.
- **Bonne réponse** : Justine sépare : les questions Riga sont préparées avec Rémi (lecture société 2) ; les questions VD vont aux agents VD / à Mobi. Un brouillon par sujet, dans le fil ; Mobi envoie. Si Mobi a déjà répondu lui-même : ne rien préparer.
- **Erreur à éviter** : envoyer au comptable ; mélanger les pièces des deux sociétés dans une même réponse.

### Situation 7 — Rappel d'eau « pour Riga »
- **Situation** : un rappel d'un distributeur d'eau arrive sur info@, au nom d'une personne privée, adresse à Verviers.
- **Bonne réponse** : comparer avec les contrats connus de Riga (numéro de client, domiciliations trimestrielles) : si ce n'est ni Riga ni VD, c'est **hors dossier** → le signaler à Mobi, pas de brouillon.
- **Erreur à éviter** : l'encoder chez Riga parce que le mail est arrivé pendant la veille du dossier.

### Situation 8 — Facture adressée à DGJ VHU
- **Situation** : Gaëtan reçoit une facture d'un fournisseur de conteneurs, TVA destinataire BE0731879153.
- **Bonne réponse** : c'est DGJ VHU. Gaëtan ne peut pas lire la société 3 aujourd'hui : il le dit, transfère vers l'alias d'encodage DGJ **seulement** après accord de Mobi (risque de doublon non vérifiable), et note la pièce dans son suivi.
- **Erreur à éviter** : l'encoder chez VD (même site, mêmes personnes) ; affirmer qu'elle n'est pas encore encodée.

### Situation 9 — La gérance DGJ impayée
- **Situation** : côté VD, deux factures « Prestation gérance » de DGJ (6 050 € chacune) sont non payées.
- **Bonne réponse** : c'est un flux interne : informer Mobi (paiement à décider côté VD) ; aucune relance de DGJ vers VD, aucun mail.
- **Erreur à éviter** : préparer une « relance » de DGJ à VD, ou utiliser le module Relances clients.

### Situation 10 — Une amende pour un camion de Riga
- **Situation** : un PV arrive pour un camion loué par Riga à VD, conduit par un chauffeur VD.
- **Bonne réponse** : signaler que la société payeuse est **à confirmer** (le module Amendes crée la pièce chez VD ; Riga a déjà payé une transaction de police). Préparer les faits (plaque, date, chauffeur, propriétaire du véhicule) pour Mobi.
- **Erreur à éviter** : décider seul de la société et encoder la pièce.

## Mise à jour du 05/10/2026 — factures entre sociétés du groupe

- Les factures Riga → VD (location des camions) et, plus généralement, entre sociétés du groupe, sont **créées automatiquement des deux côtés** dans l'ERP (décision d'Olivier, 05/10/2026).
- Une telle facture reçue par mail (info@ ou administration@, dossier « Dépannage Riga ») **ne part jamais à l'encodage** : ce serait un doublon.
- Justine / Rémi : vérifier qu'elle existe **chez l'émetteur et chez le destinataire** (sociétés 1 et 2), même numéro, même montant. Si elle manque d'un côté ou si les montants diffèrent : **signaler l'écart** à Olivier, sans rien créer.
- L'agent mail fait de même : facture intra-groupe absente → carte « À vérifier » (« ne pas l'encoder, signaler l'écart »).
- Mails Riga : rangés automatiquement dans « Dépannage Riga » d'info@ et d'administration@ (TVA, nom ou compte de Riga ; le mot « Riga » seul → carte à vérifier). Dans info@, aucune facture n'est transférée à l'encodage automatiquement.

**Situation d'examen.** Un PDF « Dépannage Riga SRL — facture location camions septembre » arrive sur info@ et est rangé dans « Dépannage Riga ». *Attendu* : Justine cherche la facture dans la société 2 (vente) et dans la société 1 (achat) ; les deux existent avec le même montant → rien à faire, elle le note. *À ne pas faire* : la transférer à l'adresse d'encodage des achats de VD.
