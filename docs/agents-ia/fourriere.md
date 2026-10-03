# Savoir de l'agent « Fourrière » — Verviers Dépannage

> Date de rédaction : **03/10/2026**
> Public : agent IA chargé de répondre aux questions sur la fourrière (parc, saisies, gardiennage, restitution, Domaine) dans VD Soft.
> Sources : code de VD Soft, mode d'emploi « Fourrière + Facturation » (version du 28/09/2026), règles de travail de la session fourrière, mémoire des décisions d'Olivier (alias « Mobi », IT).
> Convention : **« à confirmer »** = point non tranché ou non vérifié dans les sources ; ne jamais le présenter comme acquis.
> Les plaques et noms des exemples sont **fictifs**.

---

## 0. En une page

- Verviers Dépannage (VD) exploite un **parc / fourrière** à Pepinster. Un véhicule y entre après un remorquage (appel police, assistance, privé…) ou un dépôt par un transporteur externe.
- Dans VD Soft, un véhicule au parc = une **fiche principale** (l'enlèvement, « REM ») + une **fiche Gardiennage** enfant (le séjour au parc). Le **dossier** regroupe les actions en groupes lettrés (A = enlèvement, B = gardiennage, C = relivraison…).
- Le **gardiennage se compte en nuits passées** au parc (jamais le jour d'entrée) et **s'arrête dès que l'adresse réelle de relivraison est connue**.
- Qui paie dépend de la **source** de la fiche : saisie judiciaire → circuit **Parquet** (états de frais) ; mal garée, AVP, rodéo, accident → **propriétaire** ou assistance ; remise au **Domaine** → SPF Finances via un relevé trimestriel.
- **Un AVP ne part jamais en état de frais au Parquet.** **Pas de relance automatique au Parquet.** **Un réquisitoire est un PDF ou une photo JPG, jamais un mail en HTML.**
- La sortie du parc passe par le **parcours unique « Restituer le véhicule »** (contrôles, identité, paiement, sortie) ou par les écrans **Sorties** (AVP, destruction, Domaine, ventes).
- L'agent **informe et prépare** ; il n'envoie rien, ne supprime rien, ne modifie aucune fiche sans validation humaine.

---

## 1. Vocabulaire

| Terme | Sens dans VD Soft |
|---|---|
| **Parc / Fourrière** | Lieu de garde des véhicules. Menu « Fourrière », écran « Parc » (ou « Recherche & parcs »). |
| **Zone** | Emplacement logique du parc (A, J, K, K1, L, LABO, Transit, I…). Les zones existantes sont gérées dans l'administration du parc. |
| **Source** | Origine de la fiche : Police – Saisie, Police – Accident, Police – Mal garée, Police – AVP (abandon sur la voie publique), Police – Rodéo, Police – SNC (Siabis non couvert), assistance (Touring, Mondial/Allianz, IMA, AXA, VAB…), privé, gardiennage, legacy (fiches reprises de l'ancien logiciel). |
| **REM / REL** | Enlèvement (remorquage vers le parc) / Relivraison (du parc vers une adresse). |
| **Fiche Gardiennage** | Fiche enfant de la REM qui porte le séjour au parc. Une période facturée = un groupe ; si le véhicule reste, un nouveau gardiennage s'ouvre. |
| **Régime de gardiennage** | `assistance`, `saisie`, `siabis`, `autre` — déduit de la source de la 1re REM (accident et AVP → `autre`). |
| **Réquisitoire** | Document de la police qui ordonne l'enlèvement / la garde. PDF ou JPG. |
| **Levée de saisie** | Document qui libère un véhicule saisi : **définitive** ou **temporaire**. |
| **État de frais (EDF / EF)** | Document de créance adressé au Parquet (ou aux Frais de justice) pour une saisie. Numéroté `EDF-AAAA-NNNN`, suites `-B`, `-C`. |
| **JustInvoice** | Portail du SPF Justice où l'on dépose l'état de frais approuvé ; renvoie un numéro de dossier. |
| **Liquidation** | Statut « Transféré au bureau de liquidation » communiqué par le bureau de taxation de Liège : déclenche la facture électronique. |
| **Domaine** | SPF Finances (Services patrimoniaux) : reçoit les véhicules saisis que la police lui remet (« Date IN »), les vend (« Vente d'épaves »). |
| **Dérogation** | Autorisation d'un responsable (notification + code à 4 chiffres) pour passer un point bloquant de la restitution. |
| **Dossier de destruction** | Constat photo + frais à une date pour un véhicule envoyé à la casse depuis le parc. |

---

## 2. Le processus fourrière de bout en bout

### 2.1 Entrée au parc

**Comment un véhicule entre**
1. **Par un chauffeur** qui termine une REM et touche « mise en parc » dans l'app chauffeur. La **zone est imposée par le parc par défaut de la source** (réglage « Sources de mission » dans l'administration) — plus aucune zone codée en dur.
   Conséquences au catalogue (état connu au 22/06/2026, modifiable par réglage) :
   - assurances / garages / privé → **K** ;
   - Police – Accident et SNC → **Transit** ;
   - Police – Saisie, AVP, Rodéo → **J** ;
   - Police – Mal garée → **L**.
   - **Exception unique** : saisie **judiciaire** (motif « Saisie judiciaire ») → le chauffeur choisit **J** ou **LABO** (deux gros boutons). En LABO, l'étiquette porte un bandeau noir « ZONE LABO ».
2. **Par un transporteur externe** : tuile « **Véhicule apporté** » du tableau de bord (fourrière ou admin). On crée une fiche **source gardiennage**, sans REM. Plaque → véhicule connu, sinon marque/modèle ; châssis lu sur photo ; transporteur, n° de bon, photo du bon ; « pour qui » (inconnu = « Client divers » en attendant) ; clé, zone, photos d'état ; « Créer la fiche et imprimer l'étiquette ». La date d'entrée est modifiable si le véhicule est arrivé un autre jour.
3. **Depuis un réquisitoire reçu** sans fiche existante : l'écran « Réquisitoires » propose de créer une fiche (véhicule saisi) en parc J, préremplie, réquisitoire annexé.
4. **Fiches legacy** : reprises de l'ancien logiciel de fourrière, souvent **sans type** (146 au 21/09/2026). Leur requalification est **en attente du feu vert d'Olivier** — ne rien modifier.

**Types d'entrée et ce qu'ils impliquent**

| Type (source) | Donneur d'ordre | Qui paie au final | Circuit particulier |
|---|---|---|---|
| **Police – Saisie** | Police / Parquet | Parquet (états de frais) **ou** propriétaire (s'il reprend) **ou** Frais de justice ; Domaine après remise | Réquisitoire obligatoire ; levée obligatoire pour sortir ; cockpit « États de frais » |
| **Police – Mal garée** | Police (administratif) | Propriétaire | Restitution au comptoir (chauffeurs autorisés) ; copie de la facture acquittée au policier |
| **Police – AVP** (abandon voie publique) | Police / Ville (administratif) | Propriétaire s'il reprend ; sinon **rien** (épave) | **Jamais d'état de frais** ; Sortie AVP après 60 jours |
| **Police – Rodéo** | Police | Propriétaire (à confirmer pour une éventuelle part Parquet) | Même parcours que la saisie : **levée obligatoire** ; minimum 3 jours de gardiennage à la grille |
| **Police – Accident** | Police | Assistance / assureur / propriétaire | Zone Transit puis traitement (relivraison ou zone A) ; contrôle de sortie si un bureau d'expertise est passé |
| **Police – SNC** (Siabis non couvert) | Police | Propriétaire / client | Moteur de prix séparé ; scénario SNC obligatoire avant toute sortie |
| **Assistance** (Touring, VAB, IMA, Mondial/Allianz, AXA…) | Assisteur | Assisteur (régime assistance : 3 premiers jours inclus) | Relivraison selon la règle de la grille de l'assisteur |
| **Gardiennage** (transporteur externe) | — | Celui qui décide (client, assistance) ; « Client divers » en attendant | Régime `autre` (20 € HTVA par nuit à la grille au 28/09/2026) |
| **Privé** | Client | Client | — |

**Statuts « en parc »** (définition canonique) : `parked`, `delivering`, `unlocated`, `awaiting_payment`.

### 2.2 Garde

- **Zones** : vues sur l'écran « Parc » (compteurs par zone, places libres), le « **Plan du parc** » (glisser-déposer, temps réel, blocage d'emplacements avec motif) et l'« **Inventaire** » (filtres zone, source, motif, dates ; tri par jours en parc).
- **Transit** = zone de transit **accident**, pas une zone de stockage : tout autre véhicule en Transit est « à placer dans sa zone ».
- **K / K1** : K = file de relivraison avec vraie destination ; **K1 = « En attente d'adresse »** (adresse absente, = un de nos dépôts, ou texte d'attente comme « Choix du client », « à définir », « à confirmer », « inconnu », « en attente »).
- **Non-localisés** : véhicules en parc sans zone → écran « Non-localisés » pour leur attribuer zone / rangée.
- **Étiquette** : imprimée à la mise en parc (imprimante d'étiquettes du bureau) ; QR vers le hub du véhicule ; plaque, marque, modèle, châssis, source, date d'entrée, zone. Réimpression depuis le hub QR ou la fiche. **Les étiquettes se font depuis le module Fourrière ou l'administration, jamais par les chauffeurs.**
- **Hub QR** (scan de l'étiquette) : Transférer vers une zone, Envoyer au Domaine, Scratch / mettre en épave, Imprimer une étiquette, Ajouter des photos, Restituer.
- **Vérification physique** : le bureau peut recevoir une demande bloquante « Présent / Absent » par véhicule (fenêtre plein écran sans croix). La réponse est notée sur la fiche.
- **Historique** : onglet « Historique » de la fiche (qui, quand, quoi).
- **Écran « Parc »** : filtres par type (Saisie, Accident, AVP, SNC, Mal garée, Rodéo, Assistance, Legacy), colonnes Entrée / Documents / Gardiennage / Sortie, actions du moment (Localiser, Placer, Qualifier, Ouvrir le dossier, Domaine, Identifier le policier, Relancer, Restituer, Sortie AVP…) et « qui a la main » : **À nous / Robot / Chez eux / En veille**.

### 2.3 Frais

#### Gardiennage = nuits passées
- Règle d'Olivier (08/09/2026) : « le gardiennage ne peut pas comptabiliser le jour d'entrée… on comptabilise par nuit passée chez nous ». **Une nuit = un passage de minuit, heure belge.**
  - entrée le 06 à 06:48 → sortie le 08 à 09:00 : **2 nuits** ;
  - entrée le 06 à 22:00 → sortie le 07 à 08:00 : **1 nuit** ;
  - entrée et sortie le même jour : **0 nuit** (gardiennage « Rien à facturer »).
- Les **jours gratuits** de la grille (`free`) se retirent **après** le comptage des nuits.
- Le **Domaine** garde son propre calcul sur dates (remise → enlèvement).
- ⚠️ Le mode d'emploi (fonction 115) décrit encore une formule « (date du jour − date d'entrée) × tarif » : c'est la règle des **nuits** qui fait foi (à corriger dans le mode d'emploi — à confirmer).

#### Arrêt du gardiennage à l'adresse de relivraison
- Règle d'Olivier (22/09/2026) : « Une fois qu'une adresse (différente du dépôt) de relivraison est connue, on ne compte plus de gardiennage. Si nous prenons deux semaines à délivrer, il n'y a pas de raison que ce soit le client qui paie. »
- S'applique à **toutes les sources**. La date d'arrêt est celle où l'**adresse réelle** est posée sur la fiche. Le volet gardiennage se ferme (motif « adresse de relivraison ») ; si l'adresse est retirée, un nouveau volet s'ouvre.
- **Ne jamais recompter de nuits après cette date**, même si le véhicule est encore physiquement au parc.
- Les textes d'attente (« Choix du client », « Keuze », « à définir », « à confirmer », « inconnu »…) et nos propres dépôts **ne sont pas des adresses** : le gardiennage continue.

#### Grilles et tarifs (valeurs connues — la grille en base fait foi)
Tous les tarifs sont stockés **HTVA** ; le chauffeur voit des montants **TVAC**.

| Poste | Valeur connue | Date de la valeur |
|---|---|---|
| Gardiennage **saisie** (voiture / moto) | 1,53 €/nuit (2025) → **1,56 €/nuit (2026)** ; moto 0,78 → 0,80 | 09/08/2026 |
| Gardiennage **hors saisie** (régime « autre », après levée, mal garée, AVP, gardiennage transporteur) | **20 €/nuit** voiture ; mal garée moto 10 €/jour (mode d'emploi) | 09/08 et 28/09/2026 |
| Prise en charge saisie | 92,01 € → 94,06 € HTVA (millésime) | 09/08/2026 |
| Km saisie | 1,5717 €/km, **franchise 30 km aller-retour** | 09/08/2026 |
| Frais administratifs saisie | 37,67 € — **client uniquement**, jamais Parquet ni Domaine | 09/08/2026 |
| Forfait enlèvement Mal garée / Rodéo / AVP | 165,29 € HTVA (valeur de repli si la grille est vide) | 09/09/2026 |
| Rodéo | minimum **3 jours** de gardiennage | grille |
| Mal garée « déplacement payé » (le propriétaire arrive avant le chargement) | **125 € TVAC**, encaissé sur place, pas de mise en parc | 03/06/2026 |
| Forfait gardiennage accident | **220 € TVAC** (181,82 € HTVA) — **uniquement** source Police – Accident **et** client facturé Ethias/Kaze ; incompatible avec « Pas de frais de gardiennage » | 09/09/2026 |
| Régime assistance | 3 premiers jours inclus | 10/09/2026 |

- Les tarifs saisie sont **millésimés** : une période à cheval sur deux années est coupée au 31/12 et chaque partie prend le tarif de son année.
- Siabis couvert (Touring paie) = régime **assistance** ; Siabis **non couvert** = régime `siabis`, moteur de prix séparé.

#### Régimes saisie / hors saisie
- La période **sous saisie** reste **toujours au tarif saisie**, quel que soit le payeur.
- Seules les nuits **après le jour de la levée** passent au tarif « autre » (20 €).
- Levée **temporaire** : le gardiennage « hors période » recommence à compter du jour du **retour en parc**.
- Remise au **Domaine** : le gardiennage Parquet s'arrête à la **date de remise** ; les jours entre remise et enlèvement sont pour l'État, au tarif parc saisie, dans le **tableau trimestriel**.

#### Facturation (règles générales qui touchent la fourrière)
- Le **dossier** se facture depuis la Vue dossier : **une facture par client**, créée en **brouillon** ; le flux dossier ne valide jamais une facture tout seul.
- **Pas de facturation automatique tant que le dossier est « En cours »** (relivraison en cours, véhicule au parc).
- Le circuit **Parquet ne passe jamais par une facture directe** : il passe par l'état de frais.
- **Encaissement bureau = logiciel de facturation** ; VD Soft n'encaisse que via le chauffeur. **Encaisser ≠ clôturer.** Un prix encaissé est **figé**.

### 2.4 Le circuit Saisie / Parquet (états de frais)

**Qui entre dans le circuit** : la décision se prend sur la **source** (Police – Saisie, marquée « circuit Parquet » au catalogue), **jamais** sur le motif de saisie. Une fiche requalifiée d'après le réquisitoire garde son motif d'origine. Périmètre : saisies entrées **à partir du 01/06/2026** intégrées automatiquement ; plus anciennes intégrées si < 6 mois (décision du 16/09) ; tout dossier déjà existant est traité.

**Étapes** (écran « **États de frais** », titre « États de frais Parquet ») :
1. **En parc** — le véhicule est saisi, le réquisitoire doit arriver.
2. **À facturer** — au **dernier jour du mois suivant** l'entrée (saisie le 14/07 → facturable au 31/08), si le propriétaire n'est pas revenu.
3. **État de frais établi et envoyé** — PDF (émetteur, destinataire, véhicule, lignes dépannage + gardiennage, QR de rattachement), envoyé depuis **fourriere@verviersdepannage.be** avec le **réquisitoire joint**.
   - **Jamais plus d'une période par état de frais** : 1er = jusqu'au dernier jour du mois suivant l'entrée ; suivants = dernière coupe + 2 mois. Un rattrapage produit une **série** (EDF-…, -B, -C) jointe au même mail. (« On ne peut pas avoir 225 jours sur un état de frais. »)
   - **Gardiennage récurrent** : un nouvel état de frais tous les 2 mois, même en attendant le retour du Parquet.
   - **Destinataire** : **Frais de justice** (frais.justice.verviers@just.fgov.be) si le motif est « Saisie judiciaire » **ou** si la levée est payée par les frais de justice ; sinon **Parquet** (fdj.pplge@just.fgov.be). Les boîtes viennent des réglages métier.
   - **Complétude** : châssis + marque/modèle + n° de PV + réquisitoire joint. **La plaque est facultative si le châssis est présent.**
4. **Retour signé** — le Parquet renvoie l'état de frais **signé / cacheté** (mail ou courrier). Rattachement par le lien de validation, la veille de la boîte fourriere@, le « Scan groupé » (découpage d'un PDF de plusieurs retours, lecture du n° EDF, détection des refus) ou « Déposer le retour signé ». Boutons Accepté / Refusé = secours papier.
5. **Dépôt JustInvoice** — l'état de frais signé est déposé deux fois (État de frais + Approbation, car l'approbation est sur le même document) + le réquisitoire (Réquisition). Bureau de taxation : Liège. Dépôt automatique après validation, sauf dossier en pause.
6. **Liquidation** — mail du bureau de taxation de Liège « Changement de statut… Transféré au bureau de liquidation » sur fourriere@ → statut « liquidé » → **facture brouillon** au partenaire Parquet, référence `ROJ-FJGK13 JINV<n° de dossier>`, avec l'état de frais approuvé et le réquisitoire en pièces jointes. Envoi électronique (Peppol) à la validation de la facture.
7. **Paiement** — environ 30 jours après dossier complet.
8. **Gardiennage récurrent** jusqu'à la **remise au Domaine**, puis clôture.

**Forclusion** : un état de frais doit être introduit sur JustInvoice **dans les 6 mois** de la prestation. L'écran affiche un compteur et des alertes J-60 / J-30 / J-7.

**Pause par dossier** : un dossier peut être mis en pause (motif) ; le robot l'ignore.

**Journal par dossier** : états de frais, mails, journal de la fiche, remarques.

**Mode** : depuis le 16/09/2026, le robot de l'application **envoie seul** les états de frais dus (réquisitoire présent, dossier non en pause). C'est un automatisme de l'application, distinct de l'agent IA : **l'agent, lui, n'envoie rien**.

**Gate réquisitoire** : **pas d'état de frais sans réquisitoire valable** (PDF ou JPG). Sans réquisitoire, le bouton est désactivé et la **relance du policier** se déclenche.

**Corrections** : correction de taxation = nouvel état de frais + note de crédit avec le même numéro JustInvoice. Une fois sur JustInvoice, l'état de frais ne se signe plus.

**Bug connu au 30/09/2026** : sur la page Saisie, « annuler » un état de frais appelle une action qui n'accepte que Accepté / Refusé (à confirmer si corrigé).

### 2.5 Réquisitoires

- La police a **72 h** pour transmettre le réquisitoire ; souvent en retard.
- **Un réquisitoire est un document PDF ou JPG.** Un corps de mail (HTML) **n'est pas** un réquisitoire (incident du 03/09/2026 : 22 fiches marquées « avec réquisitoire » à tort, 5 états de frais partis avec un HTML).
- Deux formulaires de la zone de police :
  - **« Réquisitoire enlèvement / gardiennage »** (judiciaire : non-assurance, accident, vol, dégradé, indices, patrimoniale…) ;
  - **« Réquisitoire administratif »** (stationnement, accident, **abandon voie publique**, autres administratives ; le texte libre peut dire AVP ou Rodéo).
- **La case cochée décide de la source** : « Abandon voie publique » → **AVP** ; « Stationnement » → **Mal garée** ; texte « Rodéo » → **Rodéo**. Le rattachement **requalifie** la fiche et retire / clôt le dossier saisie le cas échéant.
- Arrivée : mails reçus (lecture automatique), courrier scanné, dépôt par le policier via un lien, ou « Annexer » manuel (fiche → encadré « Saisie » → « Réquisitoire » → PDF ou photo → « Annexer »). Pastille verte « Réquisitoire reçu le … ».
- Écran « **Réquisitoires** » (titre « Documents police (réquisitoires & levées) ») : documents reçus, candidats « à vérifier », création de fiche.
- **Relance du policier** (voulue, à ne pas confondre avec le Parquet) : écran « **Relance réquisitoires** », véhicules **en parc** seulement. J+3 puis tous les 7 jours, ou « Stop rappel ». Mail courtois « Réquisitoire non reçu », sans numéro de rappel ni mention d'automatisation. **Portail policier** : un lien par policier listant ses saisies sans réquisitoire (dépôt direct, « C'est mon dossier ») ; un mail groupé par policier, au plus une fois par 7 jours. Sans contact policier lié = pas d'e-mail = pas de relance : lier le policier (« Identifier le policier ») est le vrai levier.
- Zone de police et nom du policier sont **obligatoires** à la création d'un appel police (accident, saisie, rodéo, mal garée, AVP).

### 2.6 Levée de saisie

- Fiche → encadré « **Saisie — gestion judiciaire** » → « **Levée de saisie** » : type (Définitive / Temporaire), date (par défaut aujourd'hui), **document OU commentaire**, et **qui paie**. Sans document/commentaire et date, le blocage police n'est pas retiré.
- **Levée payée par le client** : le dossier Parquet **s'arrête immédiatement** ; tout ce qui reste se facture au client. Si un état de frais est **déjà parti**, il passe « **À ANNULER** » : note de crédit au Parquet, puis « Note de crédit envoyée → annulé », et la période est refacturée au client.
- **Levée « frais de justice »** : le dossier **reste** au Parquet ; un **état de frais final** (dépannage + gardiennage jusqu'à la date de levée) part tout de suite, sans attendre la fin de la 1re période.
- **Levée temporaire** : encadré « Cycle levée temporaire » → « Sortie vers garagiste » (place libérée) → « Retour en parc » (même dossier) → restitution normale ensuite.
- **Facturer le propriétaire sans levée** est toujours possible (« Facturer » dans la Vue dossier, le véhicule reste au parc). **Seule la restitution exige la levée.** Ce que le client a payé sort de l'état de frais : le Parquet ne paie que le solde. Une facture faite à la main se déclare avec « Déjà facturé… ».

### 2.7 Sortie / restitution

#### Parcours unique « Restituer le véhicule »
Bouton « 🚪 Restituer le véhicule » dans la **Vue dossier** et sur l'écran du **QR de l'étiquette**. Chaque geste est noté au journal avec le nom de l'utilisateur.
- **Qui peut restituer** : dispatch, fourrière, administrateurs = toutes les sources ; **chauffeurs = mal garées seulement**.
- **Étapes** :
  1. **Qui vient le reprendre ?** Propriétaire, mandataire, garage, assistance, transporteur. **Pièce d'identité au minimum, pour tous** les particuliers : carte eID lue au comptoir **ou** photo recto/verso + encodage (Privé / Pro avec n° de TVA vérifié). Au bureau : « Client existant ». Transporteur : CMR / ordre d'enlèvement / carte du chauffeur en photos.
  2. **Peut-il sortir ?** L'écran montre ce qui bloque : **blocage police**, **levée de saisie** (saisie et rodéo), **contrôle de sortie accident** (bureau d'expertise passé). Une levée absente se photographie ou se scanne ici. Même tout au vert, relire et toucher « Suivant ».
  3. **Qui paie quoi ?** (saisie ou rodéo repris par le client) — trois postes : dépannage ; gardiennage jusqu'à la levée ; gardiennage après la levée. Trois choix chacun : **Client / Parquet / Frais de justice**. **Saisie restituée au propriétaire = pas d'état de frais au Parquet** par défaut.
  4. **Montant et paiement** : « Confirmer, créer la facture et l'ouvrir » (accès facturation) → encaisser dans le logiciel de facturation → « Vérifier le paiement ». Sans accès facturation : encaissement chauffeur. Garage / assistance : « à facturer ». **Paiement différé** possible (facture brouillon, payable à réception, retenu pour ce client). « Ne pas facturer ce groupe » = motif obligatoire (ou dérogation pour un chauffeur). Factures antérieures encore ouvertes : chacune doit avoir une décision.
  5. **Signature et photos** (facultatif).
  6. **Sortir le véhicule du parc** : la fiche principale passe « à facturer », le gardiennage se ferme (plus une nuit de plus), la place est libérée.
- **Partir sans payer = uniquement avec dérogation**, sauf reprise par une assistance ou un garage.
- **Dérogation** : choisir un responsable (5 responsables désignés dans VD Soft au 28/09/2026), motif ; le responsable reçoit une notification et valide avec **son** code à 4 chiffres ; un responsable peut se l'accorder lui-même en tapant son code. Tout est journalisé.
- **Blocage police** : seul un **responsable** peut le retirer.
- **Mal garée payée** : une copie de la facture acquittée part au policier indiqué sur la fiche (depuis fourriere@), une fois par facture.
- **Reprise par l'assistance en relivraison** : pas de restitution au comptoir ; la sortie se fait par la REL — **la levée reste obligatoire si le véhicule était saisi**.
- **Restituer sans frais** : motif obligatoire, tracé ; geste validé par un responsable.
- **Contrôle de sortie accident** (un expert est passé) : procédure sur téléphone via QR — chemin (vente via le bureau d'expertise / autre sortie / assistance), bon de vente lu, identité comparée à l'acheteur (mandat écrit sinon), CMR, attestation signée. Passer une étape = motif + PIN personnel, tracé.
- **Pilote** : le parcours unique a été lancé le 28/09/2026 en pilote (superadmins + une pilote du bureau). Son ouverture à tous et le retrait des anciens boutons « Restituer » de la fiche sont **à confirmer**. Limite connue : l'encaissement direct (écran Encaissement) peut encore sortir un véhicule bloqué/saisi sans contrôle (écran verrouillé par Olivier).

#### Autres sorties — écran « Sorties »
Onglets : **Sortie AVP**, **Dossiers de destruction**, **Domaine** (selon droits), **Ventes** (selon droits).
- **Sortie AVP** : AVP en parc depuis **≥ 60 jours** (accord avec la Ville). On coche, on choisit Excel ou PDF, « Sortir … véhicules (épave) ». Tampon ÉPAVE, place libérée, rapport (véhicule, dates, frais arrêtés) téléchargé **et envoyé à la Ville** (avp@verviers.be) depuis fourriere@. **Aucune facture.** **Irréversible.**
- **Dossiers de destruction** : véhicules qui dorment depuis très longtemps. Au téléphone : QR ou plaque/zone, photos en rafale, lecture du châssis, marque, modèle, couleur (pas de km). Le véhicule sort, motif destruction, vers l'**épaviste désigné dans les réglages**. **Aucun envoi à la commune, aucune facture** ; coût montré sur un document. Seuls les véhicules **légalement libérables** sont proposés (saisie sans levée, accident avec expert = exclus) ; forcer = motif + PIN. **Si le propriétaire se présente plus tard, on lui présente les frais à la date de sa présentation** (le gardiennage court comme si le véhicule était encore là) ; le montant figé n'est qu'une référence. Ces véhicules n'ont souvent plus de plaque : recherche par châssis partiel, marque/modèle/couleur, période.
- **Scratch / mettre en épave** (hub QR) : irréversible ; jamais sans les documents requis (accord Ville, AVP + 60 jours…).
- **Domaine** : voir 2.8.

### 2.8 Domaine (SPF Finances)

- La police décide de **remettre au Domaine** un véhicule saisi dont le propriétaire ne se met pas en ordre. Il sera vendu puis enlevé par l'acheteur (épaviste).
- **Dates IN** : le SPF Finances envoie à fourriere@ des listes « date → véhicules (châssis, PV de remise) ». Rapprochement automatique sur les **5 derniers caractères du châssis** parmi les saisies actives (sources saisie **et legacy**). Sur correspondance unique : date de remise posée, **étiquette « DOMAINE »** imprimée, fiche legacy requalifiée en saisie. Ces mails sont souvent classés hors de la boîte de réception : chercher dans toute la boîte.
- **Vente d'épaves** : mail « à la firme X les véhicules suivants… date maximale d'enlèvement » → date de vente, firme, date d'enlèvement (= Date OUT) posées, étiquette « VENDU DOMAINE ».
- **Saisie manuelle** : fiche → encadré « Saisie » → « Domaine » : date de remise (obligatoire), date de vente si connue, document ou commentaire.
- **Facturation** : le gardiennage Parquet s'arrête à la date de remise (état de frais de clôture) ; la période remise → enlèvement va dans le **tableau Domaine**, envoyé au contact du SPF Finances qui le **valide**, puis **facture trimestrielle** (une ligne forfaitaire, tableau en annexe), créée par un superadmin. **Pas d'état de frais par mail au Domaine** : le message « Destinataire Domaine non configuré » n'est pas un manque.
- **Saisies historiques** (sans dossier Saisie) vendues au Domaine : archivées **sans facturation** ; seule la période Domaine passe au relevé trimestriel (décision du 08/09/2026).
- Écran « **Domaine** » : **superadmin seulement**.

### 2.9 Documents de la fourrière

| Document | Forme | Où il vit | Remarque |
|---|---|---|---|
| Réquisitoire (judiciaire ou administratif) | PDF / JPG | Fiche (encadré Saisie), écran Réquisitoires | Décide de la source ; obligatoire avant tout état de frais |
| Levée de saisie (définitive / temporaire) | Document ou commentaire + date | Fiche (encadré Saisie), étape « Peut-il sortir ? » | Obligatoire pour restituer une saisie / un rodéo |
| État de frais | PDF VD (EDF-AAAA-NNNN) | Écran États de frais | Une période max ; retour signé = approbation |
| Retour signé / approbation | Scan ou PDF | Rattaché à l'état de frais | Déposé sur JustInvoice deux fois |
| Facture Parquet | Facture électronique | Logiciel de facturation | Référence ROJ-FJGK13 JINV… ; annexes EF + réquisitoire |
| Tableau Domaine | Tableur | Écran Domaine | Validé par le SPF avant facture trimestrielle |
| Rapport Sortie AVP | Excel ou PDF | Téléchargé + envoyé à la Ville | Frais arrêtés, aucune facture |
| Dossier de destruction | Document imprimable | Sorties → Dossiers de destruction | Photos, état, frais à une date |
| Attestation d'enlèvement (accident / expert) | Signée sur téléphone | Fiche | Figée et imprimable |
| Pièce d'identité, CMR, signature, photos de sortie | Photos | « Documents du dossier » | Toutes les photos s'ajoutent au dossier |
| Convention de garde | — | **À confirmer** : aucun document de ce nom n'a été trouvé dans VD Soft | Ne pas inventer |

---

## 3. Règles métier à appliquer (règles du projet + décisions mémorisées)

### Gardiennage
1. Gardiennage = **nuits passées** (`nightsBetween`), jamais le jour d'entrée.
2. Il **s'arrête dès que l'adresse réelle de relivraison est connue** (≠ dépôt, ≠ texte d'attente), toutes sources.
3. Période sous saisie = tarif saisie quel que soit le payeur ; après la levée = 20 €/nuit.
4. Forfait 220 € TVAC **uniquement** Police – Accident + client Ethias/Kaze.
5. Toute règle de gardiennage vaut pour **les trois calculs** de l'estimation (forfait, paliers, lignes).

### Parquet, saisies, réquisitoires
6. **Un AVP ne part jamais en état de frais au Parquet** : soit le propriétaire le reprend et paie, soit il part en épave et rien n'est facturé. **Ne jamais écrire « à charge de la commune »**, même si un interlocuteur l'affirme.
7. Le circuit Parquet se décide sur la **source** (Saisie), jamais sur le motif. Mal garée, Rodéo, Accident : pas de circuit Parquet par défaut.
8. **Pas de relance automatique au Parquet.** Compteur « en attente depuis N jours » + alarme de forclusion ; « Relancer » manuel, discret, réservé aux cas proches de la forclusion.
9. **Un réquisitoire est un PDF ou un JPG**, jamais un HTML. La case cochée décide de la source.
10. Pas d'état de frais sans réquisitoire valable.
11. Jamais plus d'une période par état de frais.
12. Frais administratifs = client uniquement.
13. Levée client → plus de Parquet (EF partis à annuler). Levée frais de justice → EF final jusqu'à la levée.
14. Facturer le propriétaire est toujours possible ; seule la restitution exige la levée.
15. Saisie restituée au propriétaire = pas d'état de frais, sauf réponse « Parquet » / « Frais de justice » à la question « qui paie quoi ».

### Mal garée / AVP
16. Mal garée en parc depuis 60 jours « passe normalement en AVP », **mais seulement sur document** : réquisitoire administratif « abandon » reçu. **Tous les automatismes mal garée → AVP ont été retirés (10-11/09/2026)** ; ne pas les réactiver sans demande explicite.
17. Sortie AVP ≥ 60 jours, rapport à la Ville, aucune facture, irréversible.

### Restitution / sortie
18. Saisie et rodéo : **levée obligatoire** pour sortir, y compris par relivraison.
19. Pièce d'identité au minimum ; partir sans payer = dérogation (sauf assistance / garage).
20. Blocage police : seul un responsable le retire.
21. Destruction : rien à la commune ; frais à la date de présentation du propriétaire.
22. Clôture chauffeur **définitive** : une erreur se corrige côté dispatch.

### Mails et communication
23. Documents fourrière et états de frais : depuis **fourriere@verviersdepannage.be** (attention au **.be**). Le reste des mails automatisés : administration@verviersdepannage.com. Une réponse à un mail reçu sur info@ part d'info@.
24. **Ne jamais dévoiler l'automatisation** à un tiers (Parquet, police, SPF, client) : ton courtois, « Madame, Monsieur », « Auriez-vous l'amabilité… », pas de « rappel n° », pas de « rattaché automatiquement ».
25. **Pas de rejeu des mails passés** : on corrige pour le futur.
26. Brouillons = vraies réponses dans le fil, jamais envoyés sans relecture.
27. Dans les textes, Olivier = « Mobi » ou « IT », jamais « la direction ».

### Données et sécurité
28. **Jamais de suppression de fiche** sans la liste exacte et un « oui » d'Olivier ; préférer **annuler**. Une suppression de fiches au parc a fait perdre 470 fiches le 05/06/2026.
29. Ne jamais supprimer une ligne d'une commande confirmée dans le logiciel de facturation (quantité à 0).
30. Pas de rapport d'intervention attaché à une facture.
31. Le lien assisteur fait foi : ne jamais raisonner « si source = … » pour déclencher une action assisteur.
32. Couvert / non couvert se décide avant l'intervention.

---

## 4. Pièges connus

- **Mode d'emploi en retard** sur certains points : fonction 115 (formule par jours au lieu de nuits), fonctions 120-124 (ancien modal de restitution, remplacé en pilote par le parcours unique). Annoncer la règle actuelle, signaler l'écart.
- **Plusieurs états de frais en vol** : les boutons du cockpit suivent l'état global du dossier ; l'état de frais facturé est **celui qu'on scanne**, pas « le dernier ».
- **Légacy** : 146 fiches sans type comptées à 20 €/nuit (montants affichés gonflés). 62 seraient des saisies (1,56 €/nuit), 62 probablement déjà sorties. **Aucune requalification sans le go d'Olivier.**
- **Doublons de plaque** : un même véhicule peut avoir deux fiches. Les **volets Gardiennage** sont exclus des recherches par plaque : agir sur la fiche principale.
- **Épaves restées « au parc »** : un bug empêchait la sortie (corrigé le 30/09/2026 dans un commit non poussé à cette date — à confirmer). Une liste de fiches à régulariser existe au 30/09/2026 (AVP facturés à clôturer, mal garées à remettre en Mal garée, épaves détruites le 10/09 encore au parc, véhicules remis au Domaine sans trace). **Vérifier le statut actuel de chaque fiche avant toute réponse.**
- **Date de remise Domaine antérieure à l'entrée** au parc : déjà vu ; donnée à faire corriger.
- **Transit** n'est pas une zone de stockage : 157 véhicules y étaient au 16/09/2026, dont beaucoup hors accident.
- **Adresse « Choix du client »** (Touring) ou « à définir » : pas une adresse ; le gardiennage continue, zone K1.
- **Chauffeur qui encode « Saisie »** alors que le formulaire police est administratif (abandon / stationnement) : la source est corrigée au rattachement du réquisitoire.
- **Mails du SPF Finances** souvent classés dans un sous-dossier : chercher dans toute la boîte fourriere@.
- **Facture brouillon ≠ payée** : un brouillon ne compte jamais comme payé ; une facture supprimée dans le logiciel de facturation défait le lien.
- **UI figée après une mise à jour** : recharger deux fois (cache de l'application) avant de conclure à un bug.
- **Policier sans e-mail** : pas de relance possible tant que le contact n'est pas lié.
- **Rodéo** : la levée est obligatoire comme pour une saisie, mais la facturation Parquet d'un rodéo n'est pas tranchée (à confirmer).

---

## 5. Où regarder dans VD Soft

| Question | Écran (tel que l'utilisateur le voit) | Ce qu'on y trouve |
|---|---|---|
| Le véhicule est-il au parc ? où ? | **Fourrière → Parc** (« Recherche & parcs ») ou **recherche globale** (🔍) | Zone, source, date d'entrée, nuits, actions du moment |
| Plan, place libre, emplacement bloqué | **Plan du parc** | Rangées, emplacements, glisser-déposer |
| Liste filtrée / export | **Inventaire** | Filtres zone, source, motif, dates |
| Véhicule sans zone | **Non-localisés** | Attribuer zone / rangée |
| Tout le dossier d'un véhicule | **Vue dossier** (« Ouvrir le dossier » / « Consulter le dossier ») | Groupes A/B/C, estimation, payeurs, factures, journal, documents |
| Saisie : réquisitoire, levée, Domaine, motif | Fiche → encadré **« Saisie — gestion judiciaire »** | Pastilles reçu / levée / remise |
| Où en est l'état de frais | **États de frais** (titre « États de frais Parquet ») | Frise par dossier, prochaine action, qui a la main, forclusion, journal, pause |
| Réquisitoires reçus / à vérifier | **Réquisitoires** | Documents police, candidats, création de fiche |
| Réquisitoires manquants | **Relance réquisitoires** | Par véhicule / par policier, portail, stop rappel |
| Restituer un véhicule | Vue dossier ou QR de l'étiquette → **« Restituer le véhicule »** | Parcours en 6 étapes |
| Dérogation en attente | Notification du responsable | Autoriser / Refuser avec code |
| AVP de plus de 60 jours | **Sorties → Sortie AVP** | Liste, frais arrêtés, rapport |
| Véhicule détruit, quelqu'un se présente | **Sorties → Dossiers de destruction** | Recherche par châssis / marque / couleur / période ; frais à une date |
| Remises et ventes Domaine | **Domaine** (superadmin) | Dates IN, ventes d'épaves, tableau trimestriel |
| Véhicule apporté par un transporteur | Tableau de bord → **Véhicule apporté** | Création de fiche gardiennage |
| Véhicule accidenté arrivé au parc | **Accident** | Prise en charge, documents de bord, ouverture du dossier d'assistance |
| Historique des actions | Fiche → **Historique** / journal du dossier | Qui, quand, quoi |
| Facture, paiement | Vue dossier (bouton « Facturer », « Vérifier le paiement »), bouton d'ouverture dans le logiciel de facturation | État de la facture |
| Courrier papier (réquisitoire reçu par la poste) | **Courrier** | Lecture, rattachement à la fiche, « réquisitoire reçu » |
| Mail à traiter | **Agent mail** (« À décider ») | Consignes, brouillons dans administration@ |
| Ancien dossier (avant VD Soft) | Recherche avancée (anciennes données) | Lecture seule ; sinon demander le n° à Olivier |

---

## 6. Ce que l'agent ne fait jamais / ce qui part à un humain

### Jamais
- **Envoyer** quoi que ce soit au Parquet, aux Frais de justice, à la police, au SPF Finances, à la Ville ou à un client sans l'accord d'Olivier. L'agent prépare au plus un **brouillon**.
- **Relancer le Parquet** de lui-même, ni proposer une relance automatique.
- Mettre un **AVP** (ou une mal garée) en **état de frais**, ou écrire « à charge de la commune ».
- Accepter un **mail HTML** comme réquisitoire.
- **Compter le jour d'entrée**, ou compter des nuits **après** la date de l'adresse de relivraison.
- **Basculer une mal garée en AVP** sans réquisitoire « abandon » ; réactiver un automatisme retiré.
- **Supprimer** une fiche, un dossier, un état de frais, une ligne de commande confirmée ; faire des modifications en masse.
- **Restituer** (ou conseiller de sortir) une saisie / un rodéo **sans levée**, un véhicule **bloqué police** sans responsable, un accident **sous contrôle de sortie** incomplet.
- Lancer une **Sortie AVP**, un **Scratch** ou une **destruction** (actions irréversibles).
- **Valider** une facture, créer une note de crédit, modifier un tarif ou une grille.
- **Requalifier** des fiches legacy ou corriger des régularisations sans le go d'Olivier.
- Dévoiler l'automatisation à un tiers ; mentionner le logiciel de facturation par son nom dans un texte destiné à un utilisateur (seule exception : le libellé du bouton qui ouvre la facture dans ce logiciel).
- Rejouer d'anciens mails.
- Inventer un montant : renvoyer à l'estimation de la Vue dossier, qui lit la grille.

### Ce qui part à un humain
| Situation | À qui |
|---|---|
| Toute dérogation (sortie sans paiement, levée absente, pas d'identité, blocage police) | Un des responsables désignés dans VD Soft |
| Envoi / renvoi / annulation d'un état de frais, note de crédit Parquet | Olivier (Mobi) et la facturation |
| Contestation du Parquet, du bureau de taxation, refus d'un état de frais | Olivier |
| Requalification de source, correction de date de remise / d'entrée | Olivier / dispatch |
| Sortie AVP, destruction, Scratch | Fourrière avec documents, validation d'un responsable |
| Remise / vente Domaine non trouvée, véhicule « remis » sans trace | Olivier (contact avec le SPF Finances) |
| Policier sans contact | Bureau : « Identifier le policier » |
| Fiche introuvable ou doublon de plaque | Dispatch / fourrière |
| Facture déjà validée à corriger | Facturation |
| Panne d'un automatisme (veille mail, dépôt, robot états de frais) | Olivier |

---

## 7. Dix situations d'examen

> Plaques et noms fictifs.

### Situation 1 — Combien de nuits ?
- **Situation** : un véhicule d'assistance entre au parc le lundi à 23 h 30 ; il est restitué le mercredi à 7 h.
- **Question** : combien de jours de gardiennage ?
- **Bonne réponse** : **2 nuits** (lundi→mardi, mardi→mercredi). Ensuite, le régime assistance inclut 3 premiers jours : rien à facturer pour le gardiennage si la grille de l'assisteur l'applique (vérifier la grille).
- **Erreur à éviter** : compter 3 jours (jour d'entrée inclus) ou 1 jour (« tranches de 24 h »).

### Situation 2 — Adresse de relivraison connue mais véhicule toujours là
- **Situation** : véhicule Touring au parc depuis le 01/10 ; le 03/10 le dispatch pose l'adresse réelle du garage ; la relivraison n'a lieu que le 15/10.
- **Question** : jusqu'à quand compte-t-on le gardiennage ?
- **Bonne réponse** : jusqu'au **03/10** (date où l'adresse réelle a été posée). Les nuits du 03 au 15 sont à notre charge.
- **Erreur à éviter** : facturer jusqu'au 15/10 ; ou arrêter le gardiennage sur une adresse « Choix du client – Keuze » (ce n'est pas une adresse).

### Situation 3 — AVP réclamé par le Parquet
- **Situation** : le Parquet écrit que les frais d'un AVP au parc depuis 4 mois sont « à charge de la commune » et demande un état de frais.
- **Question** : que répond-on ?
- **Bonne réponse** : un AVP **ne part jamais en état de frais**. Deux issues seulement : le propriétaire le reprend et paie, ou il part en épave (Sortie AVP après 60 jours) sans facture. L'agent ne répond pas lui-même : il signale à Olivier ; aucune mention « à charge de la commune ».
- **Erreur à éviter** : générer un état de frais, ou reprendre la formule « à charge de la commune ».

### Situation 4 — Réquisitoire reçu dans le corps d'un mail
- **Situation** : un policier répond « Voici le réquisitoire » ; le texte est dans le mail, sans pièce jointe.
- **Question** : peut-on considérer le réquisitoire comme reçu et envoyer l'état de frais ?
- **Bonne réponse** : **non**. Un réquisitoire est un **PDF ou une photo JPG**. Le dossier reste bloqué (« Réquisitoire manquant ou non valable »). Demander poliment le document (relance du policier, portail policier).
- **Erreur à éviter** : rattacher le HTML du mail ; relancer le **Parquet** au lieu du policier.

### Situation 5 — Réquisitoire « administratif – stationnement »
- **Situation** : un chauffeur a encodé « Saisie » ; le PDF reçu est un réquisitoire **administratif** avec la case « Stationnement » cochée.
- **Question** : quel circuit ?
- **Bonne réponse** : la fiche est **Mal garée** (requalification au rattachement) : restitution au propriétaire, forfait mal garée + gardiennage, **pas de Parquet**. Si la case était « Abandon voie publique » → AVP.
- **Erreur à éviter** : garder la source Saisie parce que le chauffeur l'a encodée, et laisser partir un état de frais.

### Situation 6 — Levée de saisie payée par le client après un état de frais
- **Situation** : saisie entrée le 10/06 ; état de frais EDF-2026-0xyz envoyé au Parquet pour la période jusqu'au 31/07 ; le 20/09, levée définitive, le propriétaire paiera.
- **Question** : que devient l'état de frais et qui paie quoi ?
- **Bonne réponse** : le dossier Parquet **s'arrête** ; l'état de frais déjà parti passe « **À ANNULER** » → note de crédit au Parquet, puis tout est refacturé au client. Nuits jusqu'au jour de la levée au **tarif saisie**, nuits après la levée à **20 €** ; frais administratifs facturables au client. L'agent prépare, Olivier et la facturation décident.
- **Erreur à éviter** : laisser l'état de frais courir ; facturer toute la période à 20 € ; ajouter les frais administratifs au Parquet.

### Situation 7 — Levée « frais de justice »
- **Situation** : saisie judiciaire ; la levée indique que les frais sont pris en charge par les frais de justice ; le premier état de frais n'est pas encore dû.
- **Question** : que se passe-t-il ?
- **Bonne réponse** : le dossier **reste** au Parquet ; un **état de frais final** (dépannage + gardiennage jusqu'à la date de levée) part sans attendre la fin de la 1re période, adressé aux **Frais de justice** (frais.justice.verviers@just.fgov.be). S'il couvre plus d'une période, il est découpé en série (-B, -C) dans un même mail. Ensuite, sortie via le parcours de restitution (levée présente).
- **Erreur à éviter** : l'envoyer à l'adresse Parquet générale ; mettre 225 jours sur un seul état de frais.

### Situation 8 — Le propriétaire d'un véhicule saisi veut payer, sans levée
- **Situation** : le policier exige que le propriétaire paie avant de signer la levée. Le propriétaire est au comptoir.
- **Question** : peut-on encaisser ? peut-on rendre le véhicule ?
- **Bonne réponse** : **oui pour facturer** (Vue dossier → « Facturer », au propriétaire, jusqu'à une date ; le véhicule reste au parc ; le Parquet ne recevra que le solde). **Non pour rendre** : la restitution exige la levée (sinon dérogation d'un responsable, à refuser par défaut).
- **Erreur à éviter** : utiliser « Clôturer et facturer » / « Restituer » (refusé sans levée) ou faire sortir le véhicule par l'encaissement direct.

### Situation 9 — Mal garée au parc depuis 75 jours
- **Situation** : une mal garée est au parc depuis 75 jours ; personne ne l'a réclamée.
- **Question** : peut-on la passer en AVP et la mettre en Sortie AVP ?
- **Bonne réponse** : **pas sans document**. Elle passe en AVP **uniquement** quand un réquisitoire administratif « abandon » est reçu (confirmation du policier). Les bascules automatiques ont été retirées les 10-11/09/2026. Une fois AVP, le délai de 60 jours de la Sortie AVP se lit sur la fiche (date d'entrée, à confirmer si le délai court depuis l'entrée ou depuis la requalification).
- **Erreur à éviter** : changer la source soi-même ; lancer la Sortie AVP (irréversible, mail à la Ville).

### Situation 10 — Quelqu'un réclame un véhicule détruit
- **Situation** : en novembre, une personne se présente pour une voiture sans plaque partie à la destruction le 10/09 ; elle donne la marque, la couleur et la fin du châssis.
- **Question** : comment la retrouver et quels frais annoncer ?
- **Bonne réponse** : **Sorties → Dossiers de destruction**, recherche par châssis partiel, marque/modèle/couleur, période. Le dossier montre photos et état. Les frais à présenter sont **calculés à la date de la présentation** (le gardiennage a continué à courir), pas à la date de destruction. Le dossier se « ressort » ; la suite (réclamation, geste) est décidée par un humain.
- **Erreur à éviter** : annoncer le montant figé le jour de la destruction ; dire qu'un mail a été envoyé à la commune (aucun envoi pour une destruction).

### Bonus (vérification rapide)
- *Un chauffeur peut-il restituer une saisie ?* Non : les chauffeurs ne restituent que les **mal garées**.
- *Un véhicule saisi repris par l'assistance en relivraison doit-il passer au comptoir ?* Non, mais la **levée** reste obligatoire.
- *Le forfait 220 € s'applique-t-il à une fiche source Ethias (assistance) au parc ?* Non : seulement **Police – Accident** facturé Ethias/Kaze ; si c'est un accident police, corriger la source.
- *Faut-il relancer le Parquet sur un état de frais sans retour depuis 5 mois ?* Pas automatiquement ; signaler la **forclusion** proche (6 mois) à Olivier, qui décide d'un « Relancer » manuel.

---

## 8. Points « à confirmer » (liste de travail)

1. Ouverture du parcours unique de restitution à tous les utilisateurs et retrait des anciens boutons (pilote au 28/09/2026).
2. Code de dérogation d'un des cinq responsables (manquant au 28/09/2026).
3. Correction du bouton « annuler » un état de frais (bug noté au 30/09/2026).
4. Mise en ligne du correctif « épaves restées au parc » (commit du 30/09/2026 non poussé à cette date) et traitement de la liste de régularisations.
5. Facturation d'un **rodéo** au Parquet (levée obligatoire, mais circuit Parquet non tranché).
6. Point de départ des 60 jours de la Sortie AVP pour une mal garée requalifiée AVP.
7. Mise à jour du mode d'emploi (fonction 115 en jours au lieu de nuits ; fonctions 120-124).
8. Existence d'une « convention de garde » dans VD Soft (non trouvée).
9. Zone « I » comme zone Domaine (citée par le mode d'emploi, non vérifiée dans la liste des zones en base).
10. Requalification des fiches legacy (proposition du 21/09/2026 en attente).
11. Valeurs tarifaires : celles de ce document datent d'août-septembre 2026 ; la grille en base fait foi.
