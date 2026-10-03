# Agent IA « Facturation » — savoir de référence

> État au **03/10/2026**. Document interne pour l'agent IA facturation de Verviers Dépannage (VD).
> L'agent lit l'ERP (Odoo) et VD Soft **en lecture seule par défaut**. Il explique, vérifie, signale et prépare ; il n'écrit rien sans un accord explicite d'Olivier ou du bureau.
> Ce qui n'est pas sûr est marqué **à confirmer**. Les exemples (plaques, numéros, clients) sont **fictifs**.
> Voir aussi `equipe.md` (qui est qui, qui valide quoi).

---

## 0. L'essentiel en dix lignes

1. **VD Soft** tient les missions, le parc, les dossiers et les encaissements chauffeur. **Odoo** tient les clients, les devis, les factures, les notes de crédit et les paiements. La **comptabilité** est tenue par un **comptable externe**, pas dans Odoo.
2. Chaîne : mission → clôture chauffeur (« Terminer ») → fiche **À facturer** → **dossier** (groupes A, B, C…) → facture **brouillon** dans Odoo → facture comptabilisée → paiement lu dans Odoo → relances si impayé.
3. Les tarifs sont stockés **HTVA** (grilles, Odoo). Seul le montant montré au **chauffeur** pour encaisser sur place est **TVAC** (TVA belge 21 %).
4. Un **robot** facture tout seul les missions « sèches » (dépannage ou remorquage sans suite) des assisteurs dont la règle est activée, au moins 2 h après la clôture (délai réglable), passage toutes les 15 min.
5. Plusieurs assisteurs ont **leur propre circuit** : Touring (COMEX BKO), Allianz/Mondial (Hexalite) s'**autofacturent** ; le Parquet passe par **états de frais** ; le Domaine par un **relevé trimestriel**.
6. Le **bureau encaisse dans Odoo**, jamais dans VD Soft. VD Soft n'enregistre que l'argent reçu **par le chauffeur** sur place.
7. **Encaisser ≠ clôturer** : seul « Terminer » fait passer une mission en « À facturer ».
8. Un prix **encaissé** par le chauffeur est **figé** : il ne bouge plus, même si un recalcul donnerait autre chose.
9. Depuis le **02/10/2026**, les listes de facturation n'affichent **plus aucun tarif calculé** : le montant se calcule **à l'ouverture du dossier**. « Facturer le lot » a été **retiré**.
10. Les impayés des **clients privés et garages** sont relancés à **J+15** puis **J+30** après l'échéance ; **jamais** les assisteurs à plateforme, le Parquet ni le Domaine.

---

## 1. Comment VD facture

### 1.1 La chaîne complète

| Étape | Où | Ce qui se passe | Qui |
|---|---|---|---|
| 1. Réception | VD Soft | La mission arrive (connecteur assisteur, mail, téléphone, police, chauffeur). Le **client facturé** (« Facturer à ») est posé dès l'arrivée : assisteur, client privé, garage, Parquet… | Automatique + dispatch |
| 2. Couvert / non couvert | VD Soft | Décidé **avant** l'intervention, à la réception ou à l'attribution. Jamais après coup. | Dispatch (lecture automatique des mentions de l'assisteur) |
| 3. Intervention | App chauffeur | Pointages (en route, sur place, chargé…), photos, éventuellement **encaissement sur place** (TVAC). | Chauffeur |
| 4. Clôture | App chauffeur | Bouton « Terminer » : la fiche passe **À facturer**. Clôture **définitive** : une erreur se corrige côté dispatch, pas par le chauffeur. | Chauffeur |
| 5. Dossier | VD Soft | La fiche principale + ses suites (gardiennage, relivraison…) forment un **dossier** à groupes lettrés. | Automatique |
| 6. Facture | Odoo (créée depuis VD Soft) | Une facture **brouillon** par client de facturation, créée directement (sans devis) depuis le dossier, par le bureau ou par le robot. | Bureau ou robot |
| 7. Comptabilisation | Odoo | Le brouillon est validé (comptabilisé). Le robot comptabilise seul certaines factures automatiques dans une bande de montants réglée par Olivier ; le reste est validé à la main. | Bureau / robot |
| 8. Vérification | VD Soft | Toutes les **10 min**, un robot vérifie les factures liées : facture comptabilisée → la fiche passe **Terminée** et sort de la liste. | Robot |
| 9. Paiement | Odoo | Le paiement est encodé / lettré dans Odoo. VD Soft le **lit** toutes les 2 h (état « payée » ou « en paiement ») et marque le dossier payé, sans clic. | Bureau / comptable |
| 10. Relances | VD Soft → mail | Facture comptabilisée, échue et impayée : relance à J+15, puis J+30 (clients privés, garages, sources sans plateforme). | Robot (si activé) |

### 1.2 Le dossier et ses groupes (A, B, C…)

- Un **dossier** = la fiche principale (souvent un remorquage) + tout ce qui en découle : **séjours au parc** (gardiennage), **relivraisons**, et les mails sans action (annulés, ignorés) rattachés pour information.
- Chaque action ou séjour reçoit une **lettre chronologique** collée au numéro de dossier, sans tiret : `10999999A`, `10999999B`…
- Types de groupes :
  - **Remorquage / dépannage / trajet à vide / transport** (la fiche principale ou une action réelle) ;
  - **Gardiennage** (séjour au parc, fiche technique créée automatiquement à chaque entrée au parc) ;
  - **Relivraison** (le véhicule repart du parc vers une adresse) ;
  - pseudo-groupes d'affichage (Domaine, Sortie) qui ne se facturent pas.
- Chaque groupe porte : son **montant HTVA estimé**, ce qui est **déjà facturé** dessus, son **client facturé** (il peut différer d'un groupe à l'autre), ses **remarques de facturation** (à lire avant de facturer), ses **encaissements chauffeur**, et son **canal** : Odoo (normal), Parquet (état de frais) ou Domaine (relevé trimestriel).
- Un groupe peut être « **rien à facturer** » avec une raison : annulé, sans frais (motif), gardiennage offert (abandon volontaire), aucune nuit facturable, relivraison revenue au parc / 0 km, déjà réglé.
- Un groupe peut être « **à calculer** » : le moteur ne sait pas produire le montant (km inconnus, adresse non localisée, tarif introuvable, règle à choisir dans la grille). La **raison est affichée** : il faut la lire avant toute conclusion.

### 1.3 Facturer un dossier (le geste du bureau)

- Bouton **« Facturer »** sur le dossier : on **coche les groupes** à facturer. L'app crée **une facture brouillon par client de facturation**.
  - Tout coché = facture totale ; une partie = **facture partielle** (le reste reste à facturer, sans double comptage).
  - Référence de la facture = numéro du dossier + lettres couvertes (ex. « 10999999 A B »), une section par groupe.
  - Les groupes à **0 €** du même client sont « couverts » par la facture mais **n'y figurent pas** (pas de ligne à 0 €). Un client dont tous les groupes sont à 0 € ne reçoit **pas** de facture.
  - Un groupe dont le tarif n'est pas calculable n'est **jamais** facturé avec une facture vide.
  - Un seul « Facturer » à la fois par dossier (verrou contre le double clic / deux utilisateurs).
  - Les lignes peuvent être vérifiées et modifiées dans la fenêtre avant envoi.
  - La plaque est reportée sur la facture (véhicule retrouvé ou créé dans Odoo).
- **Gardiennage en cours** coché : la période facturée s'arrête à la date choisie (ou maintenant) et un **nouveau groupe** s'ouvre pour la période suivante.
- Autres boutons de la fenêtre :
  - **Devis** : crée un devis dans Odoo au lieu d'une facture ; rien n'est marqué facturé.
  - **Déjà facturé** : on renseigne le numéro d'une facture faite à la main dans Odoo.
  - **Sans frais** : motif obligatoire, noté au journal.
  - **Autofacturé** : pour un dossier validé dans COMEX (Touring s'autofacture, aucune facture Odoo).
- Quand **tout** est facturé, sans frais ou à 0 €, et que le véhicule est sorti du parc, la fiche principale passe **Terminée** toute seule. Un brouillon Odoo non comptabilisé **ne compte pas** comme facturé.
- Une fiche **annulée** ne se facture pas. Si elle avait déjà été facturée, c'est une **note de crédit** qu'il faut, pas une annulation.

### 1.4 Le robot d'auto-facturation

**Ce qu'il fait** : il crée la facture **brouillon** dans Odoo pour les missions simples, sans intervention humaine.

**Quand** : passage toutes les **15 minutes** ; il ne prend une mission que **2 heures après sa clôture** (délai par défaut, réglable). Au plus 25 factures par passage.

**Conditions, toutes nécessaires** :
- fiche **À facturer**, ni devis ni facture déjà liés ;
- question « autoroute / Siabis » **tranchée** ;
- la règle **source × type** est **activée** pour cette source. Types activables : dépannage (DSP), remorquage (REM), trajet à vide, relivraison. Le **transport / rapatriement** reste **manuel** quoi que dise la règle (grille par gabarit en rodage depuis le 21/09/2026). Le type combiné remorquage + relivraison est exclu ;
- mission **sèche** : pas de fiche mère, pas de relivraison ; un gardiennage encore ouvert ou une relivraison en attente = dossier « en cours » → jamais d'auto-facture, il partira groupé à la sortie ;
- un **vrai tarif** est disponible ; sinon la fiche reste manuelle (« sans tarif ») ;
- la mission n'est **pas dans COMEX BKO** (Touring la traite) ;
- source Allianz/Mondial : la mission n'est **plus dans la liste Hexalite « à clôturer »** ; si Hexalite est injoignable, le robot **saute** toutes les missions Allianz de ce passage par prudence ;
- Siabis couvert facturé à Touring : jamais (circuit COMEX).

**Après** : si le montant HTVA tombe dans la **bande d'auto-comptabilisation** (réglage, bornes fixées par Olivier), la facture est comptabilisée tout de suite ; sinon elle reste brouillon pour contrôle humain. Le robot de vérification (10 min) passe ensuite la fiche en Terminée.

**Ce que le bureau voit** : badge « **Robot** » sur la carte (« Le robot facture au prochain passage » ou « … à HH:MM »), avec un bouton « Facturer maintenant ». Un **bandeau orange** en haut de « À facturer » liste les fiches que le robot rate **deux fois de suite** ; un nouvel essai a lieu toutes les 15 min ; si la fiche y reste, on la facture à la main ; si le bandeau dit que le robot ne tourne plus, on prévient Olivier. L'écran « **Stats facturation auto** » donne la part robot / manuel. Le détail de chaque passage (mission, résultat, raison) est conservé (dernier passage + 20 derniers passages utiles).

**Hors robot par décision (16/09/2026)** : combinés, transports, **particuliers, garages** → manuel.

**Note** : depuis le 02/10/2026, les robots ne déclenchent **jamais** de calcul d'itinéraire payant ; ils utilisent la mémoire des trajets et un service gratuit. Un trajet jamais calculé peut donc laisser une fiche « sans tarif » pour le robot (**à confirmer** en pratique) : il suffit qu'un humain ouvre le dossier.

> Attention au vocabulaire : « **auto-facturation** » désigne aussi le cas où **l'assisteur se facture lui-même** (Touring COMEX, Allianz Hexalite) : la fiche est marquée réglée **sans facture Odoo**. Ne pas confondre avec le robot qui **crée** une facture Odoo. Dans les deux cas la fiche porte la méthode « auto ».

### 1.5 Les assistances, une par une

Règle générale : **le lien assisteur fait foi** (identifiant Hexalite, Comet, Kaze, go&assist, COMEX). Une fiche requalifiée dans une autre source mais qui garde son lien reste pilotée par l'assisteur. Ne jamais raisonner sur la seule source.

**Couvert / non couvert** : une mission envoyée par un assisteur est **couverte** sauf mention contraire lue à la réception. Pas de « tranchage autoroute » pour un assisteur. Les mentions connues :
- IMA (Ethias, P&V…) : « présenter la facture pour acquittement » au conducteur = **non couvert** ; « facture à établir à l'ordre de … c/o IMA » = **couvert**.
- AXA : « frais … à charge du client », convention « Siabis remorquage non couvert » = non couvert.
- VAB : le panneau « Informations supplémentaires » ou le contrat peut dire non couvert ; « paiement des frais : conducteur » vise les petites fournitures, **pas** le remorquage.
- Allianz/Mondial : aucun signal → couvert par défaut.
- Un non couvert devient une fiche **Siabis non couvert** : le client paie sur place et se fait rembourser.

| Assisteur | Canal d'arrivée | Comment ça se facture | Particularités |
|---|---|---|---|
| **Touring** | COMEX (connecteur) | **Autofacturation par Touring** via le back-office **COMEX BKO** : VD valide le dossier chez Touring (km + statut), Touring génère sa facture / son accord. Côté VD, la fiche est marquée réglée, **sans facture Odoo**. | Écran **« Touring »** (Facturation › Assisteurs) : rapprochement par numéro de dossier, montant Touring vs montant VD. Verdict « ok » si Touring ≥ VD (tolérance 5 % ou 2 € minimum), « à vérifier » sinon (risque de sous-paiement : jamais validé automatiquement). Le robot « auto-accept COMEX » valide seul les « ok » toutes les 15 min. Seul le **dépôt** peut être corrigé automatiquement, jamais les adresses d'intervention / destination (simple alerte). **Un dossier accepté en COMEX ne se recalcule et ne se refacture jamais.** Km : Touring compte le total remorquage + relivraison moins les km inclus. Un **rapatriement** Touring (type transport) = facturation **normale**, pas COMEX. Dossiers hors COMEX à faire trancher par Touring : module **Check Touring** (lien de réponse, rapprochement mensuel avec les accords ; les réponses ne s'appliquent qu'après clic superadmin). Annulation par Touring après départ du chauffeur = déplacement facturable. |
| **Allianz / Mondial** (même assisteur) | Hexalite (connecteur) | **Clôture dans Hexalite** = soumission du résultat (type de service, heures réelles des pointages, distance, destination localisée) ; Allianz s'autofacture. Côté VD, fiche marquée réglée, sans numéro de facture chez nous. | Écran **« Clôture Allianz »**. Clôture automatique **60 min** après la fin de mission (fenêtre de vérification, délai confirmé par Olivier). Trois types de service seulement : remorquage, réparé sur place, trajet à vide. Une destination de remorquage **non localisée** donne des montants à 0 → clôture bloquée. Les lignes « Siabis » Allianz = clôture manuelle. Si l'accès Hexalite expire, rien n'est clôturé (prudence). Une mission Allianz **sortie** de la liste Hexalite repasse dans le circuit normal (robot ou manuel). Relivraison : tous les km au prix du km de la grille, prise en charge une seule fois. |
| **VAB** | Comet (connecteur) | Facture Odoo classique adressée à VAB (**à confirmer** : mode d'envoi exact). Clôture séparée dans Comet (robot de reprise toutes les 15 min). | Groupe « VAB » dans la liste. Relivraison : km au-delà de ce que le remorquage a laissé (mode « km après inclus »). Clôture Comet parfois bloquée par la connexion navigateur intermittente de VAB : ce n'est pas un problème de facture. |
| **IMA** (Ethias, P&V, Vivium…) | **Kaze** (connecteur) ou mail | Facture Odoo adressée à **l'entité indiquée par la mission** (en général « P&V Assistance c/o IMA Benelux » ; parfois IMA Assurances France, **sans TVA belge** — autoliquidation ; rarement IMA Benelux). | **Rejets IMA** « en-tête de facture incorrect » : cause connue = fiches entrées par l'ancien parsing mail facturées à Ethias au lieu de l'entité IMA. Le préfixe du dossier ne suffit pas à deviner l'entité : seuls Kaze ou le mail de rejet le disent. Arbitrages (bascule par défaut, notes de crédit, traitement du stock) **en attente d'Olivier** → **à confirmer**. IMA annule d'office une facture non traitée à 180 jours. Annulation Kaze après départ du chauffeur = **trajet à vide facturable**. Relivraison : tous les km aller-retour × prix du km. Groupe de liste « Kaze · Ethias · P&V · IMA ». |
| **AXA** (et Ardenne Prévoyante, même groupe) | go&assist (connecteur) + mail | Facture Odoo classique. | Tarifs **par tranches de km** avec majoration hors heures (18 h–7 h, week-end, jours fériés). Relivraison = grille remorquage complète (un groupe = un forfait). **Accident police** repris par AXA ou Ardenne : client facturé = celui réglé dans **Réglages › Sources** (« client à facturer pour un accident police »), pas le défaut. go&assist auto-clôture seul après 3 jours sans action. |
| **Eurocross, ANWB, AG, TSE** | mail / manuel | Facture Odoo classique. | Pas de règle de relivraison dans la grille : le moteur répond « règle à choisir dans Tarifs » et le robot ne facture pas → **demander à Olivier**. |
| **Siabis** (autoroute) | police / assisteur | **Non couvert** : le client paie sur place au chauffeur (TVAC). **Couvert** : facturé à l'assistance, **jamais** de montant à encaisser au chauffeur ; s'il est facturé à Touring → circuit COMEX. | **Moteur de prix séparé** (pas dans la grille des assisteurs) : prise en charge, km, balisage, majoration selon la plage horaire. Le **scénario** (dépannage, remorquage client, remorquage direct, remorquage via dépôt) est **obligatoire** : sans scénario, pas de montant. Le non couvert part toujours du dépôt de référence. La relivraison d'un dossier requalifié Siabis n'est jamais Siabis : elle revient à l'assistance d'origine. |

### 1.6 Particuliers et garages

- **Particulier (appel privé)** : le chauffeur annonce et encaisse sur place le montant **TVAC** (espèces, carte, virement). La fiche passe À facturer au « Terminer » ; le bureau fait la facture Odoo en tenant compte de l'encaissement (badge « X € encaissé »), sans refacturer ce qui est payé.
- **Restitution au comptoir** (véhicule au parc) : parcours « Restituer le véhicule » ; « Confirmer, créer la facture et l'ouvrir » crée la facture brouillon et l'ouvre dans Odoo, où le bureau l'**encaisse** ; puis « Vérifier le paiement ». La case **« Paiement différé »** laisse partir le véhicule avec une facture à payer à réception (retenue pour ce client). Les groupes au nom d'un autre client ont leur propre facture (« Créer la facture des autres clients »).
- **Garages** : facturation **manuelle** (hors robot). Les garages partenaires ont un espace client ; ils ne voient **ni les tarifs** ni l'identité du chauffeur. Une annulation par le garage après acceptation : le dispatch choisit annulation totale ou **déplacement facturé**.
- Client inconnu à l'entrée au parc : facturé provisoirement à « **Client divers** », à corriger ensuite.
- Les **clients privés et garages** sont les seuls (avec les sources sans plateforme) que les relances automatiques visent.

### 1.7 Le gardiennage (règles de calcul)

- Compté en **nuits passées** au parc (passages de minuit, heure belge), **jamais le jour d'entrée**. Entré et sorti le même jour = 0.
- Les **jours offerts** du tarif se retirent ensuite (ex. le régime « assistance » inclut des premiers jours).
- Le gardiennage **s'arrête** dès que l'**adresse réelle de relivraison** (différente du dépôt) est connue : le retard de livraison est à la charge de VD. « Choix du client », « à confirmer », « inconnu »… ne sont **pas** des adresses et n'arrêtent rien.
- **Saisie** : la période sous saisie reste au tarif saisie ; seules les nuits **après le jour de la levée** passent au tarif « autre ». À la **remise au Domaine**, la période à charge du Parquet s'arrête.
- **Avance acquise** : si un client a payé jusqu'à une date et que le véhicule part plus tôt, on ne rembourse pas et il ne reste rien à facturer.
- **Forfait gardiennage** : une case spéciale existe uniquement pour un **accident police** repris par Ethias/Kaze ; elle remplace le comptage au jour.
- « **Sans frais** » (motif) et « **gardiennage offert** (abandon volontaire) » mettent le groupe à zéro ; « sans frais » vaut pour **tous** les groupes de la fiche (remorquage compris), notamment en cas de **destruction**.

### 1.8 Relivraison

- La règle vient de la **grille Tarifs** (colonne « Relivraison, mode »), par assisteur. **Aucune exception par source dans le code.**
  - **Km après inclus** (Touring, VAB) : un seul forfait (sur le remorquage), la relivraison facture les km au-delà des km inclus non consommés ; Touring part du dépôt le plus proche.
  - **Tous les km** (Ethias, IMA/Kaze, P&V, Vivium, Mondial, Allianz) : prise en charge une fois sur la première mission, chaque relivraison = tous ses km aller-retour parc ↔ adresse × prix du km.
  - **Tarif remorquage** (AXA, Ardenne) : la relivraison repasse par la grille remorquage complète.
  - Sans ligne (Eurocross, ANWB, AG, TSE) : « règle à choisir dans Tarifs ».
  - Appel police / Siabis sans ligne : grille remorquage de la source d'origine.

### 1.9 Parquet et Domaine (hors facture classique)

**Parquet (saisies judiciaires)** — écran **« États de frais »** (Fourrière › Facturation) :
- Le donneur d'ordre est le Parquet. Le circuit se décide sur la **source** « police saisie », jamais sur le motif coché.
- Étapes : réquisitoire reçu (document **PDF ou JPG**, jamais une capture de mail) → **état de frais** (EF) → approbation signée par l'autorité **sur l'EF lui-même** → dépôt sur **JustInvoice** (portail SPF Justice, numéro JINV) → taxation → « transféré au bureau de liquidation » (mail capté automatiquement) → **facture Odoo** (référence ROJ + JINV, EF approuvé et réquisitoire joints) envoyée par **Peppol** → paiement environ 30 jours après dossier complet.
- **Forclusion** : un EF doit être introduit sur JustInvoice dans les **6 mois** après la prestation ; l'écran alerte à J-60 / J-30 / J-7.
- **Pas de relance automatique au Parquet** : seulement un compteur « en attente depuis N jours » ; un bouton « Relancer » manuel, à réserver aux cas proches de la forclusion.
- Correction de taxation : nouvel EF + **note de crédit Peppol** avec le même JINV.
- On peut **facturer le propriétaire** d'un véhicule saisi **sans levée** (le véhicule reste au parc) ; ce que le client paie sort de l'état de frais. À la **levée de saisie**, le dossier Parquet s'arrête : tout le reste se facture au client ; un EF déjà parti passe « **À annuler** » → note de crédit au Parquet, puis « Note de crédit envoyée ».
- **AVP** (abandon sur la voie publique) : **jamais** d'état de frais au Parquet. Soit le propriétaire reprend et paie, soit le véhicule part à la destruction et **rien n'est facturé**. Même logique pour mal garée, rodéo, accident (pas de Parquet). Mal garée non reprise après 60 jours → sortie en épave, dossier clôturé sans facture ; mal garée payée → copie acquittée envoyée automatiquement au policier.

**Domaine (SPF Finances)** — écran **« Domaine »** (superadmin) :
- Quand la police remet un véhicule saisi au Domaine, la facturation Parquet s'arrête à la **date de remise**. Les jours entre la remise et l'enlèvement après vente sont comptés pour l'État.
- Un **tableau trimestriel** est envoyé au SPF Finances, qui le valide ; ensuite **une facture trimestrielle Odoo** (une ligne forfaitaire, tableau en annexe), comptabilisée **sans envoi automatique** (envoi groupé manuel dans Odoo).

### 1.10 Encaissements chauffeur

- Le chauffeur n'encaisse que dans **deux cas** : juste après avoir créé la mission (appel privé, Siabis non couvert…), ou au moment de **restituer** un véhicule du parc. Jamais une vieille facture ni un gardiennage isolé.
- Montant affiché au chauffeur = **TVAC**. Tout le reste (grilles, devis, factures) est **HTVA**.
- **Encaisser ne clôture pas** la mission : seul « Terminer » la fait passer À facturer.
- À l'encaissement **complet**, le prix est **figé** : les lignes de facture sont fixées au montant payé (détail conservé pour le Siabis, sinon une ligne « suivant montant encaissé »). Un paiement **partiel** ne fige rien. Une fiche déjà facturée ou avec prix convenu n'est pas refigée.
- Le mode « **à facturer** » permet au chauffeur de solder l'écran de paiement sans argent (le client recevra une facture) ; il ne touche pas la caisse. Un paiement carte **refusé** n'est jamais « à facturer ».
- Les encaissements apparaissent sur la carte du dossier (montant, mode, chauffeur, date) et dans le fil de la facture Odoo, pour **ne pas refacturer** ce qui est payé.
- **Encaissement bureau = Odoo** : aucun bouton « Encaisser » côté bureau dans la facturation VD Soft ; seulement « Ouvrir dans Odoo » et le statut « payée » lu dans Odoo.

### 1.11 Notes de crédit

Ce qui est sûr :
- Une fiche **annulée après facturation** demande une **note de crédit** (pas une annulation dans VD Soft).
- **Parquet** : levée de saisie après envoi d'un EF → note de crédit au Parquet ; correction de taxation → NC Peppol + nouvel EF, même JINV.
- **Agent mail** : pour une « demande de note de crédit » reçue, il propose ; « Appliquer » lance dans Odoo l'action « **Créditer et facturer** » : la note de crédit est comptabilisée et lettrée avec la facture d'origine, la **nouvelle facture reste en brouillon**, adressée à la bonne entité, à relire et valider par un humain.
- Un **remboursement bancaire** (reprise) **rouvre la facture** ; on ne fait **pas** de note de crédit pour ça.
- **Décisions closes, à ne pas reproposer** : les anciennes factures Siabis émises avec un montant incomplet restent telles quelles (pas de NC, pas de refacturation) ; un dossier accepté en COMEX n'est jamais refacturé.

**À confirmer** : la procédure générale du bureau pour une note de crédit hors agent mail (faite à la main dans Odoo ? par qui ?) ; le traitement des factures IMA envoyées à la mauvaise entité (notes de crédit par le bureau ou automatisées : arbitrage d'Olivier en attente).

### 1.12 Relances clients

- **Robot de relance** (passage toutes les 2 h, avec la lecture des paiements) : facture **comptabilisée, non payée, échéance dépassée** →
  - **J+15** après l'échéance : relance courtoise ;
  - **J+30** : relance plus ferme, au plus tôt 7 jours après la première.
  - Une seule fois par niveau et par facture ; au plus 25 relances par passage ; envoyées au client facturé depuis la boîte **administration** de VD.
  - Délais et mode (« off » = lit les paiements sans envoyer de mail ; « on » = envoie) dans les réglages du groupe Facturation. **Valeur actuelle du mode : à confirmer** (la valeur de départ était « off »).
- **Jamais relancés** : Parquet / SPF Justice, Domaine / SPF Finances, Touring (et ANWB), Allianz/Mondial, IMA/Kaze, VAB, AXA (le lien assisteur fait foi), et les clients portant l'étiquette « **Exclure relances** » dans Odoo.
- Le module **« Relances clients »** (menu Finance) garde l'historique et permet des relances manuelles par niveaux. Quand Olivier dit « **rappel** », il parle de ce module.
- Sur la carte du dossier : « relancé le JJ/MM (J+15) », « partiellement payée », « payée le … ».

---

## 2. Où regarder

### 2.1 Écrans de VD Soft (noms vus par l'utilisateur)

| Écran | Menu | Ce qu'on y lit |
|---|---|---|
| **À facturer** | Facturation | Une carte par dossier : frise Intervention → Clôture → Montant → Facture → Payé, **une prochaine action**, et un badge **qui a la main** : *À nous*, *Robot*, *Chez eux* (COMEX, Hexalite, Parquet, Domaine…), *Client* (facture émise, paiement suivi), *Pas prêt* (parc, relivraison en cours), *Terminé*. Groupes de liste : Toutes (hors Touring), VAB, Kaze · Ethias · P&V · IMA, Mondial, AXA, Touring. **Aucun tarif calculé** : seulement factures émises, encaissements, montant Touring. |
| **Facturation par dossier** | Facturation (version non pilote) | Même contenu, présentation en liste. |
| **Facturation du dossier** | depuis une carte | Une ligne par prestation avec le pourquoi du montant, cases à cocher, un bouton. **C'est ici que le montant se calcule.** |
| **Vue dossier** | depuis la fiche (dispatch) | Le dossier complet : groupes, faits (entrée, sortie, durée, clés, réquisitoire, levée, Domaine), journal, factures. |
| **Liste par fiche (ancienne)** | Facturation | Ancien écran par mission, en extinction. |
| **Missions terminées** | Facturation | Onglets Tous, À facturer, Facturées, Sans frais, Annulées, Archivées. |
| **Stats facturation auto** | Facturation | Part robot / manuel. |
| **Touring** | Facturation › Assisteurs | File COMEX BKO, verdicts ok / à vérifier, bouton « Valider et facturer ». |
| **Clôture Allianz** | Facturation › Assisteurs | Missions encore « à clôturer » dans Hexalite, décompte avant clôture automatique. |
| **Check Touring** | à côté de Touring | Dossiers hors COMEX soumis à Touring. |
| **États de frais** | Fourrière › Facturation | Cockpit Parquet : EF, retours, dépôt JustInvoice, liquidation, forclusion, « à annuler ». |
| **Domaine** | Fourrière (superadmin) | Remises, ventes d'épaves, tableau trimestriel, facture trimestrielle. |
| **Relance réquisitoires** | Fourrière | Relances au **policier** pour obtenir le réquisitoire (voulues, à ne pas confondre avec une relance au Parquet). |
| **Encaisser / Mouvements / Ma caisse** | Finance | Encaissements chauffeur et caisse. |
| **Relances clients** | Finance | Historique et relances manuelles. |
| **Réconciliation** | Finance (superadmin) | Rapprochement bancaire / lettrage. |
| **Tarifs** | Administration | Grilles par source et type (HTVA), règle de relivraison par assisteur. |
| **Réglages › Sources** | Administration | Catalogue des sources : client facturé par défaut, client pour accident police, étiquettes (assistance, Hexalite, Touring, rapport sur facture…). |
| **Agent mail** | — | Demandes de note de crédit, contestations, doubles paiements, rappels de paiement reçus. |

> Coût : ouvrir un dossier calcule son montant et peut déclencher un **calcul d'itinéraire payant** (geste humain). L'agent ne doit **pas** ouvrir des dizaines de dossiers en rafale « pour voir » : lire d'abord ce qui est déjà stocké (factures, encaissements, montant figé), et demander avant tout calcul de masse.

### 2.2 Objets de l'ERP (Odoo) à lire

| Objet | Ce qu'il contient | Champs utiles |
|---|---|---|
| **Factures et notes de crédit** (`account.move`) | Factures clients (`out_invoice`) et notes de crédit (`out_refund`). | `name` (numéro, format AAAA/MM/NNN), `state` (brouillon / comptabilisée / annulée), `payment_state` (non payée, partielle, **en paiement**, **payée**, extournée), `amount_untaxed` (HTVA), `amount_total`, `amount_residual` (reste dû), `invoice_date`, `invoice_date_due` (échéance), `ref` (référence : dossier + lettres, ou ROJ/JINV pour le Parquet), `partner_id`. « Payée » et « en paiement » valent **soldée** pour VD Soft. |
| **Lignes de facture** (`account.move.line`) | Détail : prise en charge, km, gardiennage, majorations, divers. | Libellé, quantité, prix unitaire, montant. |
| **Devis / bons de commande** (`sale.order`) | Devis créés depuis VD Soft (option « Devis ») ou anciens flux. | `state` : brouillon/envoyé ou **confirmé** (`sale`/`done`). |
| **Clients** (`res.partner`) | Assisteurs, clients privés, garages, institutions. | Nom, TVA, mail de facturation, étiquettes (dont « Exclure relances »). Attention : Odoo 19 n'a plus de champ « mobile ». |
| **Véhicules** (`fleet.vehicle`) | Plaque reportée sur la facture ; le rapport d'intervention y est attaché. | Plaque, châssis. |
| **Tickets** (`helpdesk.ticket`) | Rapport d'intervention de la mission. | — |
| **Paiements, extraits bancaires** | Lettrage des factures. | Une ligne d'extrait par document lettré. |
| **Fil de discussion** de la facture | Encaissements chauffeur notés (mode, montant, date, chauffeur), pièces. | — |

**Sociétés** : la base Odoo contient **plusieurs sociétés** (VD, Riga, DGJ VHU). Les lectures faites par l'app voient **VD seulement** par défaut. Ne **jamais** conclure qu'une autre société est vide sans avoir lu dans son contexte.

### 2.3 Données VD Soft utiles (lecture)

- Fiche mission : statut (`to_invoice` = À facturer, `completed` = Terminée, `cancelled`…), client facturé (`billed_to_name`), méthode de facture (`invoice_method` : auto, manual, dossier…), numéro et lien de la facture Odoo, devis lié, montant encaissé / annoncé (TVAC), prix convenu, montant estimé figé (HTVA), sans frais (motif), scénario Siabis, liens assisteurs, date de paiement lue dans Odoo, dates des relances J+15 / J+30.
- `client_name` = la personne sur place ; `billed_to` = qui paie. Ne pas les confondre.
- Postes déjà facturés par groupe (avec période pour le gardiennage) : registre des postes facturés.
- **Journal** de la fiche : facturé, figé à l'encaissement, auto-comptabilisé, payé, relancé, source changée, annulé…
- Traces des robots : dernier passage du robot de facturation (détail par mission), de l'auto-acceptation COMEX, de la clôture Allianz, de la synchro COMEX.

---

## 3. Ce qu'on ne touche jamais, et ce qui demande Olivier ou le bureau

### 3.1 Interdits fermes

1. **Aucune écriture** dans Odoo ni dans VD Soft sans accord explicite (créer, valider, annuler, modifier, supprimer, envoyer). Lecture seule par défaut.
2. **Aucun mail** envoyé à un tiers (client, assisteur, Parquet, comptable) sans accord. Les mails automatisés partent de la boîte **administration** (états de frais : boîte **fourrière**).
3. Ne **jamais dévoiler l'automatisation** à un tiers (pas de « traité automatiquement », « robot », « IA » dans un message externe).
4. Ne **jamais supprimer une ligne** d'un bon de commande **confirmé** (quantité à 0 si un humain corrige).
5. Ne **jamais attacher le rapport d'intervention** (ou tout PDF non comptable) à une facture ou un devis : l'export comptable prendrait ce PDF au lieu de la facture. Exceptions voulues : justificatifs d'**avances de fonds** ; sources marquées « rapport sur facture » dans le catalogue.
6. **Encaissement bureau = Odoo**. Ne jamais proposer d'encaisser une facture dans VD Soft.
7. **Encaisser ≠ clôturer.** Ne jamais suggérer qu'un encaissement fasse passer une mission À facturer.
8. **Prix encaissé = figé.** Ne jamais proposer de recalculer ou corriger à la hausse un montant déjà payé au chauffeur ; tout écart se signale, il ne se « corrige » pas en silence.
9. Ne jamais mélanger **TVAC** (chauffeur) et **HTVA** (grilles, Odoo).
10. **Un AVP ne part jamais en état de frais.** Pas de **relance automatique au Parquet.** Un réquisitoire est un **PDF ou JPG**, jamais un HTML.
11. **Couvert / non couvert** se décide avant l'intervention ; pas de tranchage autoroute pour un assisteur.
12. **Le lien assisteur fait foi** : ne jamais raisonner « source = X donc… » quand un lien Hexalite, Comet, Kaze, go&assist ou COMEX existe.
13. **Relivraison** : la règle est celle de la grille ; aucune exception par source.
14. Ne **jamais recalculer ni refacturer** un dossier accepté en COMEX. Ne pas reproposer de corriger les anciennes factures Siabis incomplètes.
15. **Pas de rejeu des mails passés** : on corrige pour le futur, l'historique sert de corpus de test.
16. **Lettrage** : une ligne d'extrait par document ; jamais de paiement groupé ; ne jamais rouvrir un lettrage correct ; une reprise rouvre la facture (pas de note de crédit).
17. **Comptabilité** : elle est chez le comptable externe. Ne pas ouvrir de débat sur le compte d'imputation, la TVA déductible ou le solde d'un compte ; le critère de justesse ici est : la facture se solde-t-elle, le paiement est-il attribué une fois et une seule.
18. **Suppression** : jamais sans la liste exacte et un « oui » ; préférer annuler.
19. Ne pas déclencher de calculs d'itinéraire en masse (coût).
20. Dans tout texte destiné à un utilisateur final : pas de jargon technique, et pas le mot « Odoo » (sauf le bouton « Ouvrir dans Odoo »).

### 3.2 Ce qui demande Olivier (« Mobi ») ou le bureau

| Sujet | Qui |
|---|---|
| Valider / comptabiliser un brouillon, l'envoyer, le modifier | Bureau |
| Note de crédit, refacturation, changement de client facturé sur une facture émise | Bureau, avec Olivier si c'est un cas de principe |
| « Sans frais », geste commercial, dérogation (départ sans payer, sans pièce d'identité…) | Un responsable (avec son code) |
| Couvert / non couvert à trancher, scénario Siabis | Dispatch / bureau |
| Règles du robot (source × type), délai, bande d'auto-comptabilisation, activation des relances | Olivier |
| Grille Tarifs, règle de relivraison manquante (Eurocross, ANWB, AG, TSE…) | Olivier |
| Entité IMA à facturer en cas de doute, stock de factures IMA mal adressées | Olivier |
| Relance manuelle du Parquet près de la forclusion, dépôt JustInvoice | Bureau fourrière / Olivier |
| Réponses Touring du Check Touring (appliquer) | Superadmin |
| Annuler chez Kaze des jobs de fiches annulées (impact facturation IMA) | Olivier |
| Doubles paiements, remboursements | Momo / bureau |
| Toute question comptable (imputation, clôture, TVA) | Comptable externe, via Olivier |

---

## 4. Vocabulaire

| Terme | Sens |
|---|---|
| **HTVA / TVAC** | Hors TVA / TVA comprise (21 %). Grilles et Odoo en HTVA ; chauffeur en TVAC. |
| **Mission / fiche** | Une intervention dans VD Soft (numéro à 8 chiffres). |
| **Dossier** | La fiche principale + ses suites (gardiennage, relivraison…). |
| **Groupe** (A, B, C…) | Une action ou un séjour au parc du dossier, avec sa lettre ; unité de facturation. |
| **Volet gardiennage** | Fiche technique d'un séjour au parc, créée automatiquement. |
| **DSP / REM / REL / DPR** | Dépannage sur place / remorquage / relivraison / déplacement (trajet à vide). |
| **Mission sèche** | Sans fiche mère ni suite (pas de relivraison, pas de gardiennage ouvert) : seule éligible au robot. |
| **Combiné** | Dossier à plusieurs groupes : facturation manuelle. |
| **Client facturé** (« Facturer à ») | Qui paie. ≠ le client sur place (`client_name`). |
| **Couvert / non couvert** | L'assistance paie / le client paie (il se fait rembourser ensuite). |
| **Siabis** | Intervention sur autoroute (dépanneur agréé) ; moteur de prix séparé. **SNC** = Siabis non couvert, **SC** = Siabis couvert. |
| **Scénario** | Pour le Siabis : dépannage, remorquage client, remorquage direct, remorquage via dépôt. Obligatoire. |
| **Prise en charge (PEC)** | Forfait de base d'une intervention. |
| **Km inclus** | Km compris dans le forfait ; au-delà, prix du km. |
| **Majoration** | Supplément nuit / week-end / jour férié selon la source. |
| **Tranches** | Mode tarifaire par tranches de km (groupe AXA / Ardenne). |
| **Nuits de gardiennage** | Unité de comptage du parc ; jamais le jour d'entrée. |
| **Sans frais** | Groupe ou fiche mis à 0 avec motif tracé. |
| **Prix figé** | Montant fixé à l'encaissement chauffeur, qui ne varie plus. |
| **Montant à calculer** | Le moteur ne peut pas chiffrer ; la raison est affichée. |
| **Brouillon / comptabilisée** | Facture Odoo pas encore validée / validée (numérotée définitivement). |
| **Auto-comptabilisation** | Validation automatique d'une facture du robot dans la bande de montants réglée. |
| **Autofacturation** | L'assisteur se facture lui-même (Touring COMEX, Allianz Hexalite) : pas de facture Odoo chez VD. |
| **Robot de facturation** | Crée des factures brouillon Odoo pour les missions sèches éligibles. |
| **COMEX / COMEX BKO** | Plateforme Touring : missions / back-office d'autofacturation. **Accord** = regroupement facturé par Touring. |
| **Hexalite** | Plateforme Allianz (Mondial). |
| **Comet** | Plateforme VAB. **Kaze** : plateforme IMA. **go&assist** : plateforme AXA. |
| **État de frais (EF)** | Créance détaillée adressée au Parquet pour une saisie judiciaire. |
| **Réquisitoire** | Ordre écrit de la police / du Parquet (PDF ou JPG). |
| **Levée de saisie** | Fin de la saisie (définitive ou temporaire) ; coupe la période Parquet. |
| **JustInvoice / JINV** | Portail SPF Justice / numéro de dépôt de l'EF. |
| **Liquidation** | Paiement validé par le bureau de liquidation après taxation. |
| **Forclusion** | Délai de 6 mois pour introduire un EF ; au-delà, perdu. |
| **Peppol** | Réseau de facture électronique (obligatoire pour l'État). |
| **Domaine** | SPF Finances : véhicules saisis remis à l'État, facturés trimestriellement. |
| **AVP** | Abandon sur la voie publique (jamais de Parquet). |
| **Mal garée, rodéo, accident** | Sources police à circuit client, pas Parquet. |
| **Note de crédit (NC)** | Annule tout ou partie d'une facture émise (« avoir »). |
| **Lettrage** | Rapprocher un paiement et la facture qu'il solde. |
| **Reprise** | Remboursement bancaire qui rouvre une facture. |
| **Relance J+15 / J+30** | Rappels de paiement automatiques après l'échéance. « Rappel » chez Olivier = module Relances clients. |
| **Paiement différé** | Le véhicule part, la facture est payée à réception. |
| **Client divers** | Client provisoire en attendant le vrai. |
| **Momo Market** | Liste des missions prenables par les chauffeurs ; pour le Siabis, la plaque y décide couvert / non couvert. |

---

## 5. Dix situations d'examen

### Situation 1 — Le robot ne facture pas
**Situation.** Un dépannage sur place pour une assistance dont la règle « DSP » est activée a été clôturé il y a 5 heures. Il est toujours « À facturer », badge « À nous ».
**Question.** Pourquoi le robot ne l'a-t-il pas facturé ?
**Bonne réponse.** Lire la raison donnée par le robot pour cette mission (détail du dernier passage, raison sous « hors robot »). Causes possibles : pas de vrai tarif (km inconnus, adresse non localisée), question Siabis non tranchée, mission liée à une autre (fiche mère / relivraison), présence dans COMEX BKO ou dans la liste Hexalite, Hexalite injoignable (Allianz), plafond de 25 par passage. Si la raison est « sans tarif », le bureau ouvre le dossier et facture à la main.
**Erreur à éviter.** Supposer que le robot est en panne, ou recalculer soi-même un prix et le proposer comme « le bon montant » sans lire la raison.

### Situation 2 — Encaissé sur place, montant différent dans le dossier
**Situation.** Particulier, remorquage : le chauffeur a encaissé 300 € TVAC par carte. À l'ouverture du dossier, le montant HTVA calculé ferait un peu plus une fois la TVA ajoutée.
**Question.** Que facture-t-on ?
**Bonne réponse.** Le montant **encaissé** : à l'encaissement complet, les lignes ont été figées au montant payé (ligne « suivant montant encaissé », environ 247,93 € HTVA pour 300 € TVAC). La facture reprend ce montant ; l'encaissement est noté dans le fil de la facture. Si le dossier montre autre chose, vérifier si le paiement était partiel (alors rien n'est figé) et le signaler au bureau.
**Erreur à éviter.** Refacturer la différence au client, ou comparer un montant TVAC à un montant HTVA.

### Situation 3 — Touring, montant plus bas que le nôtre
**Situation.** Dossier Touring dans COMEX BKO : Touring propose 85 € HTVA, VD Soft attend 100 €. Verdict « à vérifier ».
**Question.** Peut-on valider ?
**Bonne réponse.** Pas automatiquement : l'écart dépasse la tolérance (5 % ou 2 € minimum), il y a risque de sous-paiement. Un humain compare km et adresses (seul le dépôt peut être corrigé automatiquement), puis valide ou conteste chez Touring. Après validation, Touring s'autofacture : **pas de facture Odoo**. Une fois accepté, le dossier n'est **plus jamais** recalculé ni refacturé.
**Erreur à éviter.** Créer une facture Odoo à Touring pour un dossier COMEX, ou proposer de rouvrir un dossier déjà accepté.

### Situation 4 — Allianz encore « à clôturer »
**Situation.** Remorquage Mondial terminé il y a 40 minutes, présent dans la liste Hexalite « à clôturer ».
**Question.** Faut-il le facturer dans Odoo ?
**Bonne réponse.** Non. Il sera clôturé dans Hexalite (automatiquement 60 min après la fin, ou par le bouton « Clôturer dans Allianz ») avec les heures réelles, la distance et la destination localisée ; Allianz s'autofacture. Le robot de facturation l'ignore tant qu'il est dans la liste Hexalite. Vérifier que la destination est bien localisée, sinon la clôture est bloquée.
**Erreur à éviter.** Le facturer manuellement en parallèle (doublon), ou proposer de réduire le délai de 60 min.

### Situation 5 — Facture rejetée par IMA
**Situation.** Un mail d'IMA rejette une facture : « l'en-tête de la facture est incorrect ». La facture est adressée à Ethias ; la mission était arrivée par mail, pas par Kaze.
**Question.** Que faire ?
**Bonne réponse.** C'est le cas connu : les fiches de l'ancien parsing mail partaient à Ethias au lieu de l'entité IMA (le plus souvent P&V Assistance c/o IMA ; parfois IMA Assurances France, sans TVA belge). Retrouver l'entité dans le mail de rejet ou dans Kaze (le préfixe du dossier ne suffit pas), puis **préparer** pour le bureau : note de crédit + nouvelle facture à la bonne entité (« Créditer et facturer », nouvelle facture en brouillon). Arbitrage global en attente d'Olivier.
**Erreur à éviter.** Deviner l'entité au préfixe du dossier, ou modifier soi-même le client d'une facture comptabilisée.

### Situation 6 — Saisie : le propriétaire veut payer avant la levée
**Situation.** Véhicule saisi au parc depuis 20 nuits. Le propriétaire se présente et veut payer ; pas encore de levée de saisie.
**Question.** Peut-on le facturer, et que devient l'état de frais ?
**Bonne réponse.** Oui : on peut facturer le propriétaire **sans levée** (dépannage et/ou gardiennage jusqu'à une date choisie) ; le véhicule **reste au parc** (seule la restitution exige la levée). Ce que le client paie sort de l'état de frais : le Parquet ne reçoit que le solde. À la levée, le dossier Parquet s'arrête ; un EF déjà parti passe « à annuler » → note de crédit au Parquet. Gardiennage : tarif saisie jusqu'au jour de la levée, tarif « autre » ensuite.
**Erreur à éviter.** Refuser de facturer tant qu'il n'y a pas de levée, ou laisser le Parquet payer une période déjà payée par le client.

### Situation 7 — Un AVP en parc depuis longtemps
**Situation.** Fiche « abandon sur la voie publique » au parc depuis 70 jours ; quelqu'un propose d'envoyer un état de frais au Parquet.
**Question.** Est-ce correct ?
**Bonne réponse.** Non. Un AVP ne part **jamais** en état de frais. Soit le propriétaire reprend le véhicule et paie (facture au propriétaire), soit le véhicule part à la destruction (circuit AVP, accord avec la Ville) et **rien n'est facturé** (groupes « sans frais »). Le circuit Parquet se décide sur la source « police saisie », pas sur un motif.
**Erreur à éviter.** Facturer la commune ou le Parquet, ou écrire dans un courrier que les frais sont « à charge de la commune ».

### Situation 8 — Gardiennage d'une relivraison qui traîne
**Situation.** Remorquage IMA, véhicule au parc depuis le 1er du mois. L'adresse de relivraison réelle a été encodée le 5 ; la relivraison n'a eu lieu que le 19.
**Question.** Combien de nuits de gardiennage facturer ?
**Bonne réponse.** Les nuits du 1er au 5 seulement (nuits passées, sans le jour d'entrée), moins les jours offerts du tarif. Le gardiennage s'arrête dès que l'adresse réelle de relivraison est connue : le retard de livraison est à la charge de VD. La relivraison se facture selon la règle IMA de la grille : tous les km aller-retour parc ↔ adresse au prix du km, sans nouvelle prise en charge.
**Erreur à éviter.** Compter jusqu'au 19, compter le jour d'entrée, ou reporter les km inclus du remorquage sur la relivraison.

### Situation 9 — Relancer un impayé
**Situation.** Trois factures comptabilisées sont échues depuis 20 jours : un client privé, une facture AXA, une facture au SPF Justice.
**Question.** Lesquelles reçoivent la relance J+15 ?
**Bonne réponse.** Seulement le **client privé** (s'il n'a pas l'étiquette « Exclure relances » et si le mode relances est sur « on » ; sinon le robot ne fait que lire les paiements). AXA a son propre circuit ; le SPF Justice n'est jamais relancé automatiquement (pas de relance automatique au Parquet). Pour AXA ou l'État, l'agent peut signaler l'ancienneté au bureau, sans relancer.
**Erreur à éviter.** Relancer un assisteur ou l'État, ou envoyer un mail sans accord.

### Situation 10 — « La liste n'affiche plus de montant »
**Situation.** Un collègue demande pourquoi « À facturer » ne montre plus les montants à facturer, et veut « facturer tout le lot » d'un coup.
**Question.** Que répondre ?
**Bonne réponse.** Décision d'Olivier du 02/10/2026 : un seul endroit de calcul, le **dossier**. Les listes ne montrent que les montants réels (factures émises, encaissements sur place, montant proposé par Touring). Le montant s'affiche à l'ouverture du dossier ou au clic sur « Facturer ». « Facturer le lot » a été retiré : chaque dossier se facture depuis son bouton, et les missions sèches éligibles partent seules par le robot.
**Erreur à éviter.** Ouvrir tous les dossiers d'affilée pour reconstituer un total (chaque ouverture peut coûter un calcul d'itinéraire payant), ou parler d'un bug.

---

## 6. Points à confirmer (liste de travail)

- Mode actuel des relances automatiques (« on » ou « off »).
- Mode d'envoi des factures VAB et AXA (portail, mail, Peppol ?).
- Procédure générale du bureau pour une note de crédit hors agent mail.
- Traitement du stock de factures IMA mal adressées (arbitrage d'Olivier).
- Comportement du robot quand un trajet n'a jamais été calculé (depuis l'interdiction des calculs payants hors geste humain).
- Module Circuit (Spa-Francorchamps) : il a sa propre facturation automatique quotidienne ; règles non couvertes par ce document.
- Facturation finale des dossiers Kaze : rapprochement des paiements IMA via la plateforme (prévu, pas en place).
