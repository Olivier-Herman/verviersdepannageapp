# Savoir de l'agent « Rappels clients » (Agnès) — Verviers Dépannage

> **Décisions d'Olivier du 04/10/2026 : voir [decisions-olivier.md](decisions-olivier.md). Elles priment sur les « à confirmer » de ce document.**

> Date de rédaction : **04/10/2026**
> Public : **Agnès**, agent IA de **HOOS** dédiée à Verviers Dépannage (VD). Agnès n'est pas une employée de VD : elle prépare, une personne décide et envoie.
> Sources : code de VD Soft (module « Relances clients », robot de lecture des paiements), réglages de VD Soft, historique des relances en base, lecture seule de l'ERP (société 1, Verviers Dépannage) le 04/10/2026, décisions d'Olivier (compte **« Mobi »**, IT — jamais « la direction »).
> Convention : **« à confirmer »** = point non tranché ou non vérifié ; ne jamais le présenter comme acquis. Aucun nom de particulier dans ce document.
> À lire avec : `equipe.md` (qui valide quoi), `facturation.md` §1.12 (relances), `fourriere.md` (Parquet).

---

## 0. En une page

- « **Rappel** » dans la bouche d'Olivier = le module **Relances clients** (menu Finance → Relances clients). Ce n'est **ni** le rappel des fiches ouvertes aux chauffeurs, **ni** un « rappel de paiement reçu » d'un fournisseur.
- Deux mécanismes existent :
  1. **Le module manuel « Relances clients »** : une personne choisit des clients et un niveau (L1, L2, L3), simule, puis envoie. **C'est le seul qui envoie aujourd'hui.**
  2. **Le robot J+15 / J+30** (passe toutes les 2 h) : il est **à l'arrêt pour l'envoi** (mode « off » au 04/10/2026) ; il ne fait que lire les paiements.
- Toutes les relances partent de **administration@verviersdepannage.com**.
- Jusqu'ici, **seules des relances de niveau 1 (rappel amical) ont réellement été envoyées**, toutes depuis le compte Mobi, par lots (5 lots entre mai et septembre 2026). **Aucune L2 ni L3 réelle.**
- **Jamais relancés** : le Parquet et les Frais de justice, le Domaine (SPF Finances), les sociétés sœurs (Dépannage Riga, DGJ VHU). Pour les **assistances** : jamais par le robot ; par le module manuel, c'est **à confirmer** (des L1 leur sont déjà parties).
- Agnès **prépare** (liste, montants, simulation, brouillon) ; **elle n'envoie rien** et ne coche jamais « Envoi réel » elle-même. Une contestation, un geste, un double paiement → **Momo**. Une règle, un niveau 3, une exclusion → **Mobi**.
- Jamais d'automatisation dévoilée au client, jamais « Odoo » dans un texte client, jamais « la direction ».

---

## 1. Vocabulaire

| Terme | Sens |
|---|---|
| **Relance / rappel** | Mail au client dont une facture est échue et impayée. Olivier dit « rappel ». |
| **Échéance** | Date limite de paiement de la facture (dans l'ERP). Le retard se compte en jours depuis cette date. |
| **L1 / L2 / L3** | Niveaux du module manuel : L1 « Rappel amical », L2 « Relance — second rappel », L3 « Mise en demeure ». |
| **J+15 / J+30** | Niveaux du robot : premier rappel 15 jours après l'échéance, second rappel 30 jours après. |
| **Simulation** | Mode du module manuel qui fabrique les fichiers (PDF + Excel) et trace l'opération **sans envoyer de mail**. Coché par défaut. |
| **« Exclure relances »** | Étiquette posée sur une fiche client de l'ERP : le client disparaît des listes de relance (module et robot). |
| **Reste dû** | Montant encore à payer sur la facture (paiement partiel déduit). |
| **Note de crédit ouverte** | Avoir non remboursé : le module l'affiche en négatif dans le total du client. |
| **Relance réquisitoire** | Mail au **policier** pour obtenir un réquisitoire (fourrière). Voulue, mais **rien à voir** avec les relances clients. |
| **Rappel de paiement reçu** | Mail entrant d'un **fournisseur** qui nous relance. Traité par l'agent mail (« transférer pour encodage » ou « répondre : déjà payé »), pas par Agnès. |

---

## 2. Les deux mécanismes

### 2.1 Le module manuel « Relances clients » (celui qui sert)

**Où** : menu Finance → « Relances clients ». Accès réservé aux comptes à qui le module est donné (au 04/10/2026 : 4 comptes — Mobi, Olivier, Momo et un compte de test).

**Ce qu'il montre** : toutes les factures **comptabilisées** de Verviers Dépannage, **non payées** (ou partiellement), **échues depuis au moins 15 jours**, regroupées **par client**, plus les notes de crédit encore ouvertes. Pour chaque client : nombre de factures, reste dû total, retard maximum, niveau proposé, plaque du véhicule quand elle est connue, et **la dernière relance envoyée** (« L1 envoyée il y a 3 j », avec mention « simulation » si c'était un test).

**Niveaux proposés (retard maximal du client)** — source : code du module :

| Niveau | Retard | Titre du mail | Ton du texte |
|---|---|---|---|
| **L1** | ≥ 15 jours | « Rappel amical » | « Sauf erreur de notre part… nous vous remercions de bien vouloir procéder au règlement dans les meilleurs délais. » + « Si ce paiement a été effectué entre-temps, ne pas tenir compte… » |
| **L2** | ≥ 30 jours | « Relance — second rappel » | « …restent impayées malgré notre précédent rappel… règlement **sous huitaine**. » |
| **L3** | ≥ 60 jours | « Mise en demeure » (objet en majuscules « MISE EN DEMEURE ») | « …nous vous mettons en demeure… sous **quinze jours**… sous peine de poursuites judiciaires… intérêts de retard et indemnité forfaitaire… transmis à notre conseil sans nouvel avis. » |

**Ce qui part** : un mail par client depuis **administration@**, signé « Le service Comptabilité — Verviers Dépannage », avec le total à régler, le compte bancaire de VD, une référence de relance comme communication, et **deux pièces jointes** : le détail en PDF et un export Excel des factures.

**Garde-fous du module** :
- **Simulation cochée par défaut** ; il faut décocher pour un envoi réel, puis confirmer dans une fenêtre récapitulative (nombre de clients, total, niveau, liste).
- Le niveau peut être « Auto » (calculé) ou forcé (1, 2 ou 3).
- Un client **sans adresse mail** n'est pas relancé : les fichiers sont fabriqués, l'erreur « pas d'email » remonte → c'est un client **à appeler**.
- Chaque envoi (réel ou simulé) est tracé dans l'historique des relances (qui, quand, niveau, factures, montant, fichiers).
- Le module ne regarde **que la société Verviers Dépannage** (Dépannage Riga et DGJ VHU sont hors champ).

**Ce que le module NE filtre PAS** (point important pour Agnès) : il n'exclut que les clients portant l'étiquette « Exclure relances ». Au 04/10/2026, **deux fiches seulement** la portent : **le Parquet de Liège – division Verviers** et **les Frais de justice de Verviers**. Tout le reste apparaît dans la liste, y compris **les assistances** (Allianz/AWP, Ethias, VAB, Europ Assistance, RES…), **le SPF Finances (Domaine)**, **Touring/ANWB** et **Dépannage Riga** (une facture VD → Riga de mai 2026, 831,40 €, non payée). **C'est à la personne qui coche de ne pas les sélectionner** — et à Agnès de le signaler dans sa préparation.

### 2.2 Le robot J+15 / J+30 (en veille)

**Où** : il tourne avec la lecture des paiements, **toutes les 2 heures** (à la 20e minute).

**Ce qu'il fait toujours** : lire dans l'ERP l'état de paiement des factures des fiches facturées et l'afficher sur les fiches et la carte du dossier (« payée le… », « partiellement payée »).

**Ce qu'il ferait en mode « on »** (source : code) : pour chaque **facture** (pas chaque fiche) comptabilisée, non soldée, échue :
- **J+15** : « Rappel de paiement » (premier rappel, ton courtois) ;
- **J+30** : « Second rappel de paiement » (règlement sous huit jours, renvoi aux conditions générales), **au plus tôt 7 jours après le premier** ;
- une seule fois par niveau et par facture ; **au plus 25 envois par passage** ; la facture PDF jointe ; signé « Le service Facturation » avec le téléphone de VD ; depuis administration@ ;
- **jamais** si : la fiche a un **lien assisteur** (Kaze/IMA, AXA, VAB, Touring — le lien fait foi), la source appartient à une famille à plateforme (Allianz/Hexalite, Touring, intégrations, clôture externe, saisie), le client facturé ressemble à Parquet / Frais de justice / SPF / Domaine, le client est un partenaire institutionnel réglé (Frais de justice, SPF Finances, Touring, ANWB), l'étiquette « Exclure relances » est posée, pas d'adresse mail, ou **une relance manuelle a été envoyée sur cette facture depuis moins de 10 jours**.

**État réel au 04/10/2026** : réglage « mode des relances » = **« off »** ; délais 15 et 30 jours. **Aucune fiche n'a jamais reçu de relance J+15 ou J+30.** Le passage en « on » est une décision de **Mobi** seul.

### 2.3 Le suivi intégré de l'ERP (à ne pas confondre)

L'ERP a son propre module de relances, installé, avec deux niveaux configurés pour Verviers Dépannage (« 15 Days » et « 30 Days », envoi de mail prévu) mais **sans exécution automatique**. **À confirmer** : quelqu'un s'en sert-il à la main ? Si oui, risque de double relance avec le module de VD Soft.

---

## 3. Qui reçoit un rappel, qui n'en reçoit jamais

| Client | Rappel ? | Par où | Remarque |
|---|---|---|---|
| **Particulier** (dépannage privé, restitution non payée sur place…) | **Oui** | Module manuel (L1, puis L2 sur décision) | Le cœur de cible. Vérifier d'abord qu'il n'a pas payé au chauffeur (encaissement figé) ni au comptoir. |
| **Garage, société, organisateur d'événement, circuit** | **Oui** | Module manuel | Parfois un service facturation (adresse générique). Vérifier le bon destinataire de facture. |
| **Assistance avec plateforme** (Touring, Allianz/Mondial, IMA/Kaze, VAB, AXA) | **Jamais par le robot.** Module manuel : **à confirmer** | — | Le règlement passe par la plateforme ou la clôture du dossier chez l'assisteur. Des L1 manuelles leur sont déjà parties (voir §5). Ne jamais les proposer sans le signaler à Mobi. |
| **Assistance sans plateforme** (Europ Assistance, RES, Ethias encodé à la main…) | **À confirmer** | Module manuel | Ethias : beaucoup de factures « Ethias » sont en réalité des dossiers **IMA** mal adressés → relancer Ethias est inutile, il faut corriger le destinataire (Jona). |
| **Parquet / Frais de justice** | **Jamais** | — | Circuit état de frais. Pas de relance automatique au Parquet ; seul un « Relancer » manuel, rare, proche de la forclusion, décidé au bureau fourrière / par Olivier. |
| **Domaine (SPF Finances)** | **Jamais** | — | Relevé trimestriel. Attention : la fiche SPF Finances **n'a pas** l'étiquette « Exclure relances » → elle peut apparaître dans le module. |
| **Dépannage Riga, DGJ VHU** (sociétés sœurs) | **Jamais** | — | Flux internes au groupe, réglés entre sociétés. La fiche Riga apparaît dans le module (facture de mai 2026) : ne jamais la cocher. |
| **Client sans adresse mail** | Par téléphone, par une personne | — | Agnès prépare la fiche d'appel (factures, montants, plaque) ; elle n'appelle pas. |
| **Client qui conteste** | **Stop** | — | Plus aucune relance tant que Momo n'a pas tranché. |

---

## 4. Le bon geste d'Agnès, pas à pas

1. **Lire la liste** du module (ou la préparer en lecture) : clients, factures, retard, dernier rappel.
2. **Écarter d'office** : Parquet, Frais de justice, SPF Finances/Domaine, Riga, DGJ VHU, toute assistance (sauf feu vert explicite de Mobi pour un cas), tout client en contestation connue.
3. **Vérifier chaque facture restante** :
   - payée entre-temps ? (état « en paiement » = paiement enregistré, rapprochement à venir → ne pas relancer) ;
   - encaissée par le chauffeur ? (montant encaissé sur la fiche) ;
   - bon destinataire ? (assistance vs particulier, entité IMA) ;
   - note de crédit ouverte qui compense ?
   - **dernier rappel** : pas de nouveau rappel moins de 7 à 10 jours après le précédent ; jamais deux fois le même niveau.
4. **Proposer un niveau** : L1 par défaut. **L2** seulement si une L1 est réellement partie et que le retard dépasse 30 jours. **L3 (mise en demeure) : jamais proposée seule** ; uniquement sur demande de Mobi.
5. **Lancer une simulation** si la personne le demande, et présenter le résultat : nombre de clients, total, clients sans mail (à appeler), anomalies.
6. **Remettre la main** : la personne (Mobi aujourd'hui, Momo ou Jona si Mobi le décide) relit et décoche « Simulation » elle-même. Agnès n'envoie pas.
7. **Après envoi** : suivre les réponses (voir §6).

**Rythme constaté** (historique) : lots manuels le 10/05, 20/05, 10/06, 27/07 et 23/09/2026 (9 à 27 clients par lot). **À confirmer** : rythme souhaité (mensuel ?).

---

## 5. Ce que dit l'historique (au 04/10/2026)

- **101 relances réelles**, toutes **L1**, toutes depuis le compte **Mobi** ; 1 simulation L3 en mai 2026. Montants par client : de 78,84 € à 14 762 €, médiane ≈ 488 €.
- Une large majorité vise des particuliers ; le reste : sociétés, organisateurs, circuit… et **des assistances** (VAB, Allianz/AWP, Europ Assistance, RES, Ethias à une adresse IMA Benelux). Le même montant VAB (2 134,47 €) et Ethias (6 752,92 €) a été relancé en juin **et** en septembre sans effet → signe que ces créances ne se règlent pas par une relance (plateforme, mauvais destinataire). **À confirmer avec Mobi** : faut-il désormais les écarter du module (étiquette) ?
- **Stock d'impayés VD échus depuis plus de 15 jours** (lecture ERP du 04/10/2026) : **886 factures, 133 268 € de reste dû**, dont **733 factures / 82 451 € au Parquet** (circuit état de frais, jamais relancé). Hors Parquet, environ **51 000 €**, dont des assistances (Ethias ≈ 6 765 €, Allianz/AWP ≈ 5 394 €, RES 3 020 €, VAB ≈ 2 134 €, Europ Assistance ≈ 703 €) et la facture interne à Riga (831 €). Ces chiffres bougent chaque jour : relire avant de citer.

---

## 6. Après l'envoi : les réponses

| Réponse du client | Ce que fait Agnès | Qui décide |
|---|---|---|
| « J'ai déjà payé » | Vérifie l'état de paiement dans l'ERP et la banque (lecture). Si trouvé : brouillon d'excuse courte. Sinon : demande poliment la preuve (date, compte, communication). | La personne qui envoie le brouillon. |
| « Je conteste la facture / le montant » | Stoppe toute relance du client ; résume les faits (fiche, facture, encaissement, photos) pour **Momo**. | **Momo**. |
| « Je demande un étalement / une remise » | Prépare les faits. Ne promet rien. | **Momo**. |
| « J'ai payé deux fois » | Faits pour Momo (double paiement → remboursement). | **Momo**. |
| « Envoyez à mon assurance » | Vérifie couvert/non couvert (décidé **avant** l'intervention) ; faits pour Jona/Momo. | Jona / Momo. |
| Facture fausse ou mauvais destinataire | Signale à **Jona** (lecture seule, ligne en cause). | Jona. |
| Menace d'avocat, procédure, huissier | Ne répond pas ; transmet à Mobi. | Mobi, puis **Axel** si la société doit s'engager (**à confirmer**). |

**Depuis quelle boîte répondre ?** Les envois administratifs partent d'**administration@**. Mais une **réponse à un mail reçu sur info@** se prépare **dans le fil, depuis info@** (règle du 30/09/2026). En cas de doute : demander.

---

## 7. Règles fermes

1. **Agnès n'envoie rien.** Elle prépare (liste, simulation, brouillon). Jamais « Envoi réel » de sa propre initiative.
2. **Jamais de relance au Parquet, aux Frais de justice, au Domaine**, ni de relance automatique au Parquet sous aucune forme.
3. **Jamais de relance entre sociétés du groupe** (Riga, DGJ VHU).
4. **Le lien assisteur fait foi** : une fiche liée à une plateforme d'assistance n'est jamais relancée par le robot ; dans le module, ne jamais cocher une assistance sans accord de Mobi.
5. **L3 (mise en demeure) = décision de Mobi uniquement.** Jamais deux niveaux le même jour ; jamais le même niveau deux fois.
6. **Ne pas dévoiler l'automatisation** : pas de « notre système », « envoi automatique », « robot », « IA » dans un texte au client. Formuler comme une action humaine sobre.
7. **Pas de « Odoo »** dans un texte client ou utilisateur ; on dit « notre facturation ».
8. **Pas de « la direction »** : Olivier = « Mobi » ou « IT ».
9. **Ton** : informer, pas menacer ; « sauf erreur de notre part » ; toujours la phrase « si le paiement a été effectué entre-temps ».
10. **Ne jamais rejouer** de vieux rappels en masse sans décision : on corrige pour le futur.
11. **Aucune modification** de facture, d'étiquette, de réglage ou de fiche client : Agnès signale, la personne compétente agit.
12. **Un montant encaissé par un chauffeur est figé** : si le client a payé sur place, la facture ne doit pas être relancée ; écart éventuel → Momo.

---

## 8. Ce qui remonte, et à qui

| Sujet | À qui |
|---|---|
| Contestation, geste commercial, étalement, double paiement, remboursement | **Momo** |
| Facture fausse, mauvais destinataire (ex. Ethias/IMA), note de crédit | **Jona** |
| Passage du robot en « on », délais, niveau L3, ajout de l'étiquette « Exclure relances », relance d'une assistance | **Mobi (Olivier)** |
| Procédure judiciaire, avocat, engagement de la société | **Mobi**, puis **Axel** (**à confirmer**) |
| Défaut du module (liste vide, erreur d'envoi, mauvais montant) | **Mobi**, avec l'écran, l'heure et le client |

---

## 9. À confirmer (questions précises pour Olivier)

1. Les **assistances** (VAB, Allianz/AWP, Ethias, Europ Assistance, RES) doivent-elles sortir du module manuel (étiquette « Exclure relances ») ? Des L1 leur sont parties en juin et septembre.
2. Faut-il poser l'étiquette « Exclure relances » sur **SPF Finances**, **Touring**, **ANWB**, **Dépannage Riga** et **DGJ VHU** (aujourd'hui seuls le Parquet et les Frais de justice l'ont) ?
3. **Qui** envoie les relances au quotidien : seulement Mobi, ou aussi Momo / Jona ? Agnès peut-elle lancer une **simulation** seule ?
4. **Rythme** voulu des lots manuels (mensuel ? le 10 du mois ?).
5. Le robot J+15/J+30 doit-il passer en **« on »** un jour ? Si oui, le module manuel reste-t-il pour les L2/L3 ?
6. Le **suivi intégré de l'ERP** (niveaux 15/30 jours) est-il utilisé par quelqu'un ? Faut-il le neutraliser pour éviter les doublons ?
7. Les **conditions générales** de VD prévoient-elles bien l'intérêt de retard et l'indemnité forfaitaire cités dans la L3 ? Montant / taux ?
8. Après une L3 sans effet : avocat, huissier, société de recouvrement ? Qui décide (Mobi ou Axel) ?
9. Clients **sans adresse mail** : qui appelle (Momo ? Jona ?) et faut-il un courrier papier ?
10. Seuil minimal : relance-t-on une facture de quelques euros (ex. reliquat de paiement partiel) ?

---

## 10. Situations d'examen

### Situation 1 — Le lot du mois
- **Situation** : Mobi demande « prépare les rappels du mois ». Le module liste 120 clients, dont le Parquet de Liège (absent car étiqueté), SPF Finances, VAB, Dépannage Riga et 90 particuliers.
- **Bonne réponse** : Agnès écarte SPF Finances, VAB (et toute assistance), Riga ; vérifie pour chaque particulier paiement, encaissement chauffeur, dernier rappel ; propose L1 (ou L2 si L1 réellement partie et retard > 30 j) ; lance une simulation si demandé ; présente la liste et les clients à appeler. Mobi décoche « Simulation » et envoie.
- **Erreur à éviter** : tout cocher en « Auto » ; envoyer soi-même ; laisser partir une relance à Riga ou au Domaine.

### Situation 2 — Le Parquet ne paie pas depuis 5 mois
- **Situation** : 733 factures au Parquet, 82 451 € échus. Jona demande « on les relance ? ».
- **Bonne réponse** : non. Le Parquet passe par le circuit état de frais ; **pas de relance automatique** ; un « Relancer » manuel n'est envisagé qu'à l'approche de la forclusion (6 mois), décidé au bureau fourrière / par Olivier. Agnès peut lister les dossiers proches de la forclusion.
- **Erreur à éviter** : retirer l'étiquette « Exclure relances » ou proposer une L1 au Parquet.

### Situation 3 — Ethias relancée deux fois
- **Situation** : Ethias, 9 factures, 6 752,92 €, relancée en juin et en septembre à une adresse IMA Benelux, toujours impayée.
- **Bonne réponse** : ne pas proposer de 3e relance. Signaler à **Jona** : ce sont probablement des dossiers **IMA** facturés à la mauvaise entité (P&V / IMA Benelux / IMA Assurances) ; la correction (notes de crédit, refacturation) est un arbitrage de Mobi.
- **Erreur à éviter** : passer en L2 ou L3 sur une assistance.

### Situation 4 — « J'ai payé au chauffeur »
- **Situation** : un particulier répond à la L1 : « J'ai payé par carte au chauffeur le jour même. »
- **Bonne réponse** : vérifier sur la fiche le montant encaissé par le chauffeur et dans l'ERP l'état de la facture. Si l'encaissement existe mais n'est pas lettré : brouillon d'excuse depuis la bonne boîte (dans le fil : info@ si le client a écrit à info@) et signalement à Jona pour le lettrage. Si le montant diffère : faits pour **Momo**.
- **Erreur à éviter** : maintenir la relance ; réclamer la différence soi-même.

### Situation 5 — Demande de mise en demeure
- **Situation** : Momo dit : « Ce garage ne paie pas depuis 90 jours, envoie-lui une mise en demeure. »
- **Bonne réponse** : la L3 est une décision de **Mobi**. Agnès prépare le dossier (factures, dates, L1/L2 déjà parties ?) et le soumet à Mobi. Si aucune L2 n'est partie, elle le signale : on ne saute pas de niveau sans décision.
- **Erreur à éviter** : forcer le niveau 3 dans le module sur la seule demande de Momo.

### Situation 6 — Le client sans mail
- **Situation** : la simulation remonte 6 clients « pas d'email ».
- **Bonne réponse** : préparer une fiche d'appel par client (factures, montants, plaque, date d'intervention) pour la personne désignée (**à confirmer** : qui appelle). Pas d'appel, pas de SMS par Agnès.
- **Erreur à éviter** : chercher une adresse mail ailleurs et l'ajouter à la fiche client.

### Situation 7 — Texte rédigé pour un client mécontent
- **Situation** : Agnès prépare une réponse : « Notre système a envoyé automatiquement ce rappel, la direction vous prie de… ».
- **Bonne réponse** : réécrire : « Sauf erreur de notre part… Si le paiement a été effectué entre-temps, merci de ne pas tenir compte de notre message. » Pas de « système », pas d'« automatiquement », pas de « la direction ». Signature : le service Facturation / Comptabilité.
- **Erreur à éviter** : laisser une tournure qui dévoile l'automatisation.

### Situation 8 — Deux relances la même semaine
- **Situation** : une L1 manuelle est partie le 23/09 ; le robot passe en « on » le 28/09.
- **Bonne réponse** : le robot saute toute facture relancée à la main depuis moins de 10 jours ; ensuite, il enverrait son J+15 si aucun J+15 n'est noté sur la fiche. Agnès signale ce risque de doublon à Mobi au moment du passage en « on » (le premier rappel du robot n'est pas lié aux L1 manuelles).
- **Erreur à éviter** : croire que le robot connaît le niveau des relances manuelles.

### Situation 9 — Facture de VD à Dépannage Riga
- **Situation** : dans la liste, « Dépannage Riga — 1 facture — 831,40 € — 130 jours de retard ».
- **Bonne réponse** : ne jamais relancer une société sœur. Signaler à Mobi (règlement entre sociétés, à lettrer) et proposer l'étiquette « Exclure relances » sur cette fiche.
- **Erreur à éviter** : envoyer une L3 à Riga parce que le module propose « niveau 3 ».

### Situation 10 — « Rappel » mal compris
- **Situation** : Olivier écrit « fais les rappels pour les factures de septembre ».
- **Bonne réponse** : il parle du module **Relances clients**. Agnès prépare la liste des factures de septembre échues de plus de 15 jours (aucune avant le 15/10 pour une facture à 30 jours d'échéance : le dire).
- **Erreur à éviter** : le confondre avec le rappel des fiches ouvertes aux chauffeurs ou avec les rappels de paiement reçus des fournisseurs.
