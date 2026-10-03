# Savoir de l'agent d'aide aux chauffeurs — Verviers Dépannage

> **Date : 03/10/2026.** Ce document décrit l'application chauffeur (VD Soft) telle qu'elle est
> à cette date. L'app évolue souvent : si un écran ou un bouton ne correspond plus à ce qui est
> écrit ici, croire ce que le chauffeur voit à l'écran et le signaler (voir partie 5).
>
> Sources : le code de l'app, le mode d'emploi chauffeur (version du 09/09/2026, en partie
> dépassée — les écarts sont signalés), et les règles fixées par l'équipe.
> Quand une information n'est pas sûre, elle est marquée **« à confirmer »**.

---

## Sommaire

1. Le métier de chauffeur chez VD
2. L'app côté chauffeur, écran par écran
3. Les blocages fréquents et quoi faire
4. Ce que le chauffeur peut faire, et ce qu'il ne peut pas faire
5. Ce qui part au dispatch, ce qui part à Olivier
6. Règles de conduite de l'agent
7. Dix situations d'examen

---

# 1. Le métier de chauffeur chez VD

## 1.1 L'entreprise

- Verviers Dépannage (VD) : dépannage, remorquage, transport et fourrière.
- Dépôt et parc principal à Pepinster (on dit souvent « le dépôt » ou « le parc »).
- Le travail arrive surtout par les **assistances** (sociétés d'assistance des assurances),
  par la **police** (fourrière, accidents, autoroute) et par des **appels privés**.
- Le **dispatch** répartit les missions entre chauffeurs. Le dispatcher qu'on cite le plus
  souvent est **Momo**. La nuit, il y a un **dispatcher de garde**.
- **Mobi** = Olivier, le responsable informatique (IT) de l'app. Ne jamais l'appeler
  « la direction ».
- Les chauffeurs utilisent presque tous un **iPhone**, avec l'app VD Soft installée.

## 1.2 Les types de missions

| Code | Nom complet | En clair |
|---|---|---|
| **DSP** | Dépannage sur place | On répare sur place, le véhicule repart avec son conducteur. |
| **REM** | Remorquage | On charge le véhicule sur le camion et on l'emmène (garage, domicile, ou parc). |
| **REL** | Relivraison | Le véhicule est déjà à notre parc ; on le charge au parc et on le livre à une adresse. |
| **DPR** | Déplacement pour rien (« trajet à vide ») | On s'est déplacé mais rien n'a été fait (véhicule absent, client annule, pas de panne…). |
| **Transport / rapatriement** | Transport d'un véhicule | Mission de transport ; la fiche montre un bandeau « Transport / rapatriement » et le « Gabarit du véhicule » (choisi par le bureau). |
| **TGR** (Touring) | Transfert garage | Commande Touring dont le départ est notre dépôt : le véhicule est déjà chez nous. |
| **Mise en parc** | Dépôt au parc | Le véhicule remorqué est déposé dans une zone du parc au lieu d'être livré. |

Une mission peut changer de type en cours de route : un DSP peut devenir un REM (la réparation
ne marche pas), un REM peut redevenir un DSP (finalement réparé), et n'importe quelle mission
peut finir en DPR.

## 1.3 Les appels police (fourrière)

Créés par le chauffeur lui-même depuis l'app (« Créer une mission » → « Appel Police ») :

- **Police Accident** : véhicule accidenté, à la demande de la police.
- **Saisie** (judiciaire) : véhicule saisi par la police ou le Parquet. Le **motif de la saisie
  est obligatoire**. À la mise en parc d'une saisie judiciaire, l'app demande « Saisie
  judiciaire — où le mettre ? » : « 🅿️ Parking fourrière (zone J) » ou « 🔬 Zone LABO ».
- **Rodéo** : véhicule saisi après un rodéo urbain.
- **Mal Garée** : véhicule mal stationné, enlevé à la demande de la police.
  Deux issues possibles (voir 1.6).
- **AVP** : Abandon de Véhicule sur la Voie Publique. La fiche est marquée « Bloquée par la
  police » automatiquement.
- **Siabis** : intervention sur autoroute ou voie rapide (voir 1.5).
- **Appel Privé** : un particulier appelle directement ; il paie le chauffeur.

Pour tous les appels police (accident, saisie, rodéo, mal garée, AVP), **la zone de police et
le nom du policier sont obligatoires** à la création.

Bandeau « 🚓 Bloquée par la police » sur une fiche : « Le propriétaire doit être passé au
commissariat avant restitution. » Le chauffeur ne rend pas le véhicule tant que ce n'est pas levé.

## 1.4 Les assistances

Les assistances envoient des missions à VD. Certaines arrivent toutes seules dans l'app
(connexion directe), d'autres sont encodées à la main par le bureau.

| Assistance | Comment la mission arrive | À savoir pour le chauffeur |
|---|---|---|
| **Touring** | Automatique | Clôture envoyée chez Touring par l'app à la fin de la mission. Bouton « 🚗 Demander un VR (Touring) » quand Touring l'autorise. Délais surveillés (en route / sur place). |
| **VAB** | Automatique | Clôture envoyée chez VAB par l'app. |
| **IMA** via **Kaze** (Ethias, Vivium, P&V…) | Automatique (et parfois par mail) | **Signature du client obligatoire** à la clôture (une croix si le client refuse). |
| **AXA** (go&assist) | Automatique | Clôture envoyée chez AXA. |
| **Allianz / Mondial** | Automatique | Mondial et Allianz = **la même assistance**. |
| **Ethias, Vivium, Ardenne Prévoyante, P&V, AG** | Encodées à la main par le bureau (sauf ce qui passe par Kaze) | Rien de spécial côté chauffeur. |
| **Garages** | Bureau | **Jamais d'encaissement** : on facture le garage directement. |

Règles importantes :

- **Couvert ou non couvert se décide AVANT l'intervention**, au bureau ou à la création. Le
  chauffeur ne « tranche » pas après coup. Une mission envoyée par une assistance est couverte
  par elle, sauf mention contraire.
- Pour les clients qui exigent un rapport (au 03/10/2026 : **EBAC et Centracar**), la clôture
  demande 4 photos, le nom, le prénom et la signature de la personne (voir 2.11).
- Ne jamais promettre un véhicule de remplacement (VR) au client : seul le bouton Touring fait la
  demande, et rien n'est acquis tant que Touring n'a pas répondu.

## 1.5 Siabis : couvert ou non couvert

- **Siabis** = mission sur autoroute / voie rapide transmise par la police (signification exacte
  du sigle : **à confirmer**).
- **🔵 Siabis couvert** : « Facturé à l'assistance — rien à encaisser ».
- **🔴 Siabis non couvert** : « Le client paie sur place » (il se fera rembourser par son
  assurance / assistance).
- **La plaque décide.** À la création d'une fiche Siabis, le chauffeur encode la plaque. Si une
  assistance a déjà envoyé une fiche pour ce véhicule (dans les 3 dernières heures), il doit
  **la prendre** (« ➜ Prendre cette fiche ») au lieu d'en créer une nouvelle. Sinon, la fiche
  passe automatiquement en Siabis **non couvert**.
- Un chauffeur ne crée **jamais** un Siabis couvert à la main. Il peut seulement
  **demander** au dispatch de passer un non couvert en couvert (bouton « Demander Siabis
  couvert (dispatch) »).
- Sur place, il faut choisir le **scénario** :
  - « DSP — dépannage sur place »
  - « REM avec paiement immédiat » (non couvert : remorquage chez le client, paiement tout de suite)
  - « REM directe » (couvert : remorquage direct sans passer par le dépôt)
  - « REM vers dépôt Pepinster » (zone Transit ; non couvert : le client passera au bureau)
- **Balisage** (véhicule de sécurité sur autoroute / voie rapide) : à cocher s'il y en a eu ;
  ça change le tarif.
- Sans scénario choisi, **la clôture est impossible** (sauf DPR).
- Siabis non couvert en DSP ou REM client : **encaissement obligatoire avant de clôturer**.
  REM vers dépôt : le client paie au bureau, pas d'encaissement obligatoire.

## 1.6 Mal garée : deux issues

Sur une fiche mal garée, une fois « Sur place », la carte « Mal garée : que se passe-t-il ? »
apparaît :

- « Enlèvement (mise en parc) » — choix par défaut : le véhicule est chargé et part au parc
  (zone L), le propriétaire paiera à la restitution, avec le gardiennage.
- « Le propriétaire est revenu : déplacement payé » — il paie le déplacement et reprend son
  véhicule tout de suite. L'app affiche « À encaisser : X € TVAC, puis Terminer. » (montant de
  la grille ; le mode d'emploi indique 125 € TVAC). Pas de photos, pas de parc.
- Tant que rien n'est payé et que le véhicule n'est pas chargé, on peut revenir à
  « Enlèvement ».

## 1.7 La fourrière et le parc

- Le parc est divisé en **zones**. La zone de dépose est choisie automatiquement selon le type
  de mission (réglage du bureau). Exemples au 03/10/2026 : assistances / garages / privé → K ;
  police accident et Siabis non couvert → Transit ; saisie, AVP, rodéo → J ; mal garée → L ;
  saisie judiciaire → J ou LABO au choix.
- Chaque véhicule au parc a une **étiquette avec un QR code**. Scanner ce QR ouvre la
  « fiche véhicule » (hub) avec les actions possibles.
- **Gardiennage** = frais de garde au parc. On compte **les nuits passées** au parc, jamais le
  jour d'entrée. Le gardiennage s'arrête dès que l'adresse réelle de relivraison est connue.
  (Le chauffeur n'a rien à calculer : le montant est préparé par l'app.)
- **Restitution** = le propriétaire vient reprendre son véhicule. Au 03/10/2026, le nouveau
  parcours de restitution est en essai ; côté chauffeur il ne concerne que les mal garées
  (**à confirmer** pour les autres cas). Une restitution sans frais doit venir d'une décision
  validée par un responsable.

## 1.8 Une mission de bout en bout

1. **Réception** : la mission arrive (assistance, police, dispatch). Le chauffeur reçoit une
   notification « Mission assignée », ou la voit dans **Momo Market** (missions libres).
2. **Acceptation** : il ouvre la fiche, vérifie les infos, appuie sur
   « ✅ Accepter la mission ». Le dispatch est prévenu. Si le dispatch a laissé des consignes,
   une fenêtre « Instruction du dispatch » s'affiche ; il faut appuyer « ✅ OK, compris ».
3. **En route** : « 🚗 En route » (pour une relivraison : « 🚗 En route vers le parc »).
   La première fois, l'app demande quelle app de navigation utiliser (Google Maps, Waze, Plans).
4. **Sur place** : « 📍 Sur place ». Si le GPS voit qu'il est à environ 200 m, l'app propose
   « Vous semblez arrivé sur place » → « ✅ Sur place » ou « Pas encore ».
5. **Photos et diagnostic** : au moins 3 photos (compteur kilométrique, véhicule, numéro de
   châssis / VIN). Puis le chauffeur décide de la suite (réparé, remorquage, rien à faire…).
6. **Chargé** : « 🚛 Véhicule chargé sur le camion » (relivraison : « 🚛 Véhicule chargé au parc »).
7. **Livraison ou parc** : « 📍 Arrivé à destination » ou « 🅿️ Mise en parc ».
8. **Encaissement éventuel** : si le client doit payer (privé, Siabis non couvert, mal garée
   déplacement payé…), le chauffeur encaisse. **Encaisser ne clôture pas la mission.**
9. **Clôture** : « ✅ Confirmer la clôture ». La mission passe « À facturer ».
   **La clôture est définitive.**

## 1.9 Les statuts qu'un chauffeur voit

| Libellé à l'écran | Sens |
|---|---|
| Nouvelle | Arrivée, pas encore traitée par le dispatch. |
| À accepter / Assignée | Donnée à ce chauffeur, il doit l'accepter. |
| Acceptée | Il l'a acceptée, pas encore parti. |
| En route / En cours | Il est en route ou sur l'intervention. |
| Sur place | Arrivé. |
| Chargé | Véhicule sur le camion. |
| En livraison | En route vers la destination (souvent relivraison). |
| En dépôt | Mis en parc : mission finie pour lui, le dispatch gère la suite. |
| À facturer | Clôturée, le bureau facture. |
| Terminée | Finie. |
| Annulée | Annulée. |

## 1.10 Lexique des chauffeurs

- **1er départ** : chauffeur de garde de nuit appelé en premier.
- **Réserve** : chauffeur de garde de la semaine, appelé si le 1er départ ne peut pas.
- **Garde de nuit** : de 18 h à 8 h.
- **Momo Market** : la liste des missions libres que n'importe quel chauffeur peut prendre.
- **Dispatch** : le bureau qui répartit les missions.
- **Fiche** : la page d'une mission. Le numéro de mission (#10000XXX) sert de référence au téléphone.
- **Dossier** : numéro de dossier de l'assistance (affiché dans la case « Dossier »).
- **Assistance / assisteur** : société qui envoie et paie la mission (Touring, VAB…).
- **Couvert / non couvert** : payé par l'assistance / payé par le client.
- **Siabis, SC, SNC** : autoroute ; SC = Siabis couvert ; SNC = Siabis non couvert.
- **Balisage** : sécurisation de la zone avec un véhicule de signalisation (autoroute).
- **BK** : borne kilométrique (affichée en jaune avec le sens de circulation sur autoroute).
- **VR** : véhicule de remplacement.
- **VIN / châssis** : numéro de 17 caractères du véhicule (montant de portière ou bas du pare-brise).
- **Décharge** : document signé par le client qui dégage notre responsabilité (ex. « Fin
  d'intervention sans dégâts »).
- **Zone Transit, J, K, L, LABO, A** : zones du parc.
- **Étiquette / QR** : étiquette collée sur un véhicule au parc.
- **Gardiennage** : frais de garde au parc (par nuit).
- **Restitution** : rendre un véhicule du parc à son propriétaire.
- **Levée de saisie** : document qui autorise la sortie d'un véhicule saisi.
- **Relivraison** : livrer depuis le parc un véhicule remorqué avant.
- **Trajet à vide** : nom technique du DPR.
- **TVAC / HTVA** : TVA comprise / hors TVA. Le chauffeur voit toujours du **TVAC**.
- **Dérogation** : demande au dispatch quand le client ne peut pas ou ne veut pas payer.
- **Avance de fonds** : demande d'avance d'argent liée à une mission (usage exact : **à confirmer**).
- **Check camion** : rapport sur l'état de son propre camion.
- **Digibox** : boîte à clés (Rent A Car ou Dépannage).
- **Dépanneuse / camion** : le véhicule du chauffeur. L'app lui demande chaque jour de confirmer
  sa dépanneuse.
- **Talkie** : talkie-walkie dans l'app pour la garde de nuit.

---

# 2. L'app côté chauffeur, écran par écran

Les textes entre guillemets sont les libellés exacts affichés (en français).

## 2.1 Tableau de bord (accueil)

- Titre « Bonjour {prénom} », puis « Voici tes actions et modules disponibles. »
- Tuiles utiles au chauffeur :
  - « Créer une mission » (Police · Saisie · Mal Garée · SNC)
  - « Encaissement Chauffeur » (Espèces · Carte · Virement)
  - « Mes Missions » (Mes interventions du jour)
  - « Faire un check camion » (État du camion, kilométrage et anomalies)
  - « Avance de Fonds » (Demander une avance)
  - « TGR Touring »
- Si aucun module : « Aucun module activé » / « Contacte un administrateur pour t'attribuer des
  accès. » → c'est un problème de droits, à faire régler par Olivier.
- Bandeau de garde (si le chauffeur est de garde) avec, pour la réserve, l'option
  « Réserve de nuit : me proposer les missions libres » (activée par défaut, se réactive toute
  seule à 18 h).
- Bouton « 📻 Talkie » et bouton rond 📻 en bas à droite (garde de nuit seulement).

**Choix de la dépanneuse.** Fenêtre « Confirme ta dépanneuse » / « Utilises-tu bien : » →
« ✓ Oui » ou « Non, modifier » (ou « Plus tard »). Si « ⚠️ Aucune dépanneuse configurée »,
prévenir le bureau.

## 2.2 Mes missions

- Liste « Mes missions », section « En cours ».
- Bouton « + Nouvelle intervention » → « Quel type d'intervention ? » :
  - « Appel Police » (Accident · Saisie · Mal garée · SNC · AVP · Appel Privé)
  - « Intervention avec encaissement » (Mission privée à encaisser directement par le chauffeur)
- Les missions **clôturées et mises en parc disparaissent de la liste** (volontaire). Elles
  restent visibles dans « Missions terminées » (filtres : Toutes, À facturer, Terminées, Annulées).
- Liste vide : « Aucune mission » / « Vous n'avez pas de mission assignée ».

## 2.3 Momo Market (missions libres)

- Titre « 🛒 Momo Market ». Montre les missions arrivées récemment (fenêtre réglée par le bureau,
  45 minutes au 09/09/2026) et pas encore attribuées.
- Chaque carte : assistance, DSP/REM, client, plaque, adresse, ancienneté.
- Bouton « 🚗 Je la prends » → la mission est attribuée au chauffeur et sa fiche s'ouvre.
  **Prendre une mission vaut validation** : l'app l'accepte aussi chez l'assistance.
- Liste vide : « Aucune mission disponible pour le moment ».
- Messages possibles quand on appuie trop tard : « Mission deja prise par un autre chauffeur »,
  « Mission prise par un autre chauffeur a l instant », « Mission deja traitee »,
  « Mission retirée par l'assistance », « Mission expiree (> N min) ». Dans tous ces cas,
  la mission n'est plus disponible : ne pas insister, voir avec le dispatch si besoin.

## 2.4 Mission proposée (garde de nuit)

La nuit (18 h → 8 h), quand le dispatch a activé la garde de nuit automatique :

- Le **1er départ** reçoit la proposition en premier. Page « Mission proposée ».
  - « J'accepte » → la mission est à lui.
  - « Je suis déjà en mission » → l'app calcule quand il pourrait être sur place. Sans fiche en
    cours, elle demande « combien de temps » (15 / 30 / 45 min / « Plus d'1 h »).
    Moins d'une heure : il la prend ou confirme qu'il ne peut pas. Plus d'une heure :
    « J'appelle le client » (10 minutes pour décider avec le client).
  - « Rappelle-moi dans 15 min » : une seule fois.
  - Sans réponse après 2 minutes : le téléphone sonne avec un message vocal.
- La **réserve** n'est sollicitée que si le 1er départ ne peut pas ou ne répond pas.
  Elle peut aussi « Appeler » le 1er départ puis « Renvoyer la mission ».
- **Décrocher l'appel ne prend pas la mission** : seul « J'accepte » l'attribue.
- Quand quelqu'un prend la mission, les autres reçoivent « X a pris la mission ».
- Un chauffeur en congé ou « Hors ligne » n'est pas sollicité.

## 2.5 La fiche mission (vue principale)

En haut : flèche retour, type et statut, nom du client, bouton 📞 pour appeler le client, et
une barre d'étapes (Acceptée → En route → Sur place…).

Blocs possibles sur la fiche (selon la mission) :

- « Consigne du 1ᵉʳ enlèvement » (relivraison) : remarque du chauffeur précédent, en grand.
  **À lire avant de toucher au véhicule** (ex. « Ne pas démarrer le véhicule »).
- « Panne relevée à l'enlèvement » et « Photos de l'enlèvement » (relivraison).
- « Où est la clé » (relivraison) : emplacement et numéro de crochet.
- « Particularités à connaître » (bandeau rouge) : consignes du dispatch (ex. véhicule
  électrique, clé absente…).
- Bouton audio de briefing (lit la mission à voix haute).
- Bandeau Siabis (🔵 / 🔴) avec le scénario, et bouton « Choisir » ou « Modifier ».
- Carte mal garée (voir 1.6).
- Bandeau « Mission de relivraison ».
- Bandeau « Appel Privé — Encaisser le paiement / Paiement OK / Mise en parc obligatoire ».
- Cases « Facturé à » et « Dossier ».
- Adresses : intervention, destination, arrêts. Toucher une adresse permet de **naviguer** ou de
  la **modifier**. Sur autoroute, la BK et le sens sont affichés en jaune.
- Bouton « Traduire » sur la description du dispatch (version traduite / « Original »).
- Bandeau rouge « 💶 Paiement à recevoir › » quand il y a un montant à encaisser (le montant
  n'est pas sur le bouton : il s'affiche sur la page d'encaissement).
- Bandeau vert « Paiement OK » ou orange « À facturer » quand c'est réglé.

**Boutons du bas, dans l'ordre de la mission :**

| Moment | Bouton affiché |
|---|---|
| Mission assignée | « ✅ Accepter la mission » (avec « Vérifie les infos avant d'accepter. Une fois acceptée, le dispatch est notifié. ») |
| Acceptée | « 🚗 En route » (ou « 🚗 En route vers le parc » pour une relivraison) |
| En route | « 📍 Sur place » (pas pour une relivraison) |
| Sur place, pas encore de photo (nouveau parcours) | « 📷 Photos du véhicule » |
| Sur place, photos prises (nouveau parcours) | « ✅ Diagnostic terminé » + « 📷 Photos » + « ☰ Autres » |
| Remorquage dont la panne est déjà connue | « 🚛 Véhicule chargé sur le camion » |
| Relivraison, au parc | « 🚛 Véhicule chargé au parc » |
| Véhicule chargé | « 📍 Arrivé à destination » et « 🅿️ Mise en parc » |
| Paiement dû avant de livrer | le bouton devient « 💳 Encaisser X € » |
| Mis en parc | carte « 🅿️ Véhicule déposé au parc » / « Mission terminée pour toi. Le dispatcher gère la suite. » |

**Deux parcours existent.** Selon le chauffeur et l'assistance (réglage du bureau, assistance par
assistance), la fiche montre :
- le **nouveau parcours** : après « Sur place », un seul bouton « ✅ Diagnostic terminé » qui ouvre
  « Qu'est-ce qu'on fait ? » ;
- l'**ancien parcours** : boutons « 📷 Photos (x/3) », « 🏁 Terminer », « ☰ Autres actions »,
  « ❌ Refus / Impossible — Convertir en DPR ».

Les appels police (mal garée, saisie, accident, AVP, rodéo) gardent toujours l'ancien parcours.
Le parcours change à l'acceptation, jamais en pleine mission.

**Pas de bouton « Refuser » sur la fiche** dans le code au 03/10/2026 (le mode d'emploi du
09/09 en parle encore). Un chauffeur qui ne peut pas faire une mission appelle le dispatch.

## 2.6 Photos

- Écran « Photos » avec trois catégories obligatoires : « Kilométrage » (compteur lisible),
  « Véhicule » (avant, arrière, côtés, intérieur, défauts) et « VIN » (numéro de châssis visible).
- **3 photos minimum** pour clôturer (4 pour les clients à rapport, voir 2.11). Aucune photo pour
  un DPR.
- Les photos sont envoyées en arrière-plan. Si le réseau coupe, elles restent dans le téléphone et
  repartent toutes seules ; la clôture n'est pas bloquée par un envoi en attente.
- L'app lit le compteur et le châssis sur les photos pour remplir les cases à la clôture
  (« ✨ Je lis tes photos (châssis, compteur)… »). Elle peut se tromper : le chauffeur vérifie.
- Une fois la mission clôturée, **plus d'ajout de photo** côté chauffeur : passer par le dispatch.

## 2.7 « Qu'est-ce qu'on fait ? » (nouveau parcours)

Ouvert par « ✅ Diagnostic terminé ». Choix regroupés :

- « Le véhicule repart » → « Dépannage confirmé »
- « Le véhicule ne repart pas » → « Transformer en remorquage » ou
  « Remorquage + véhicule de remplacement »
- « Le véhicule est chargé » → « Véhicule livré à destination » ou « Mise en parc »
- « Rien à faire sur place » → « Déplacement pour rien »
- Si c'était un remorquage : « Finalement réparé — plus de remorquage »
- « Le véhicule part avec moi » → « 🚛 Véhicule chargé sur le camion »
- « Prise en charge » : « Standard », « Siabis couvert », « Siabis non couvert », et
  « 🚧 Balisage — change le tarif ».

Pour une fiche Siabis sans scénario, un écran plein « Qu'est-ce qu'on fait ? » s'affiche d'abord,
**sans bouton retour** : choisir le type (« Siabis — Non couvert » / « Siabis — Couvert », ou
« ↩️ Ceci n'est pas un Siabis » si hors autoroute), le balisage, puis « Que fait-on du véhicule ? ».

## 2.8 Écran de clôture de l'assistance (nouveau parcours)

Titre selon le cas : « Clôture · dépannage réussi », « Clôture · remorquage »,
« Livraison — clôture », « Déplacement pour rien ».

- « Qu'est-ce que tu as fait ? » / « Pourquoi le remorquage ? » : liste de motifs (ex.
  « Batterie à plat → redémarrée », « Crevaison → roue de secours », « Moteur cassé / HS »…).
  « Autre » est toujours en dernier.
- DPR : « Pourquoi repars-tu à vide ? ».
- Remorquage : « Où déposer le véhicule ? » → « Garage de la liste » ou « Autre adresse ».
- « Signature du client » (choix « Refuse de signer » possible).
- « Où se trouve le véhicule ? » et « Clé du véhicule » / « Où as-tu mis la clé ? ».
- « Châssis & kilométrage » (VIN complet ou 5 derniers caractères, kilométrage).
- « Remarque — facultatif » (« Un mot pour le dispatch… »).
- Bouton principal : « Valider la clôture ». Tant qu'il manque quelque chose, il affiche
  « Choisis un motif » ou « Indique où déposer le véhicule ».
- S'il manque des photos : « 📷 Prendre les photos » et « Il faut les 3 photos pour clôturer ».
- Si l'assistance refuse : message d'erreur + « Tu peux terminer ta mission quand même : le
  dispatch s'occupera de la clôture chez l'assistance. » → bouton « Continuer sans clôturer → ».
- Si l'assistance est injoignable : « Enregistré ✅ — l'assistance est injoignable pour
  l'instant, on s'en occupe automatiquement dès qu'elle revient. » → rien à faire.

Ensuite l'app enchaîne sur le récapitulatif de clôture VD (2.10), déjà prérempli.

## 2.9 Mise en parc

- Titre « Mise en parc » ou fenêtre « 🅿️ Choisir le dépôt ».
- « 🅿️ Zone de parc » : « Le véhicule va en zone X (définie pour cette source). »
- **« 🚗 État du véhicule * » obligatoire** : « ✅ Roulant » ou « 🚫 Non roulant ».
- **« 🔑 Où est la clé ? » obligatoire** : « Dans le véhicule », « Bureau Rent A Car »,
  « Digibox Rent A Car », « Digibox Dépannage », « Pas de clé ».
- 3 photos minimum.
- Pour un remorquage d'assistance : « 🅿️ Confirmer la mise en parc » demande l'adresse de
  relivraison ; si elle n'est pas connue → « 🕒 Adresse communiquée plus tard ».
- Bouton final : « 🅿️ Confirmer la mise en parc à {dépôt} ».
- Après : la mission est « En dépôt », finie pour le chauffeur.

## 2.10 Récapitulatif de clôture VD (« Clôturer la mission »)

- Type final : « DSP Réussi », « REM Confirmé », « REL Livrée », « DPR — Déplacement pour rien ».
- « Récapitulatif (cliquer pour modifier) » : véhicule, « 📍 Itinéraire », « 📷 Photos » (x / 3 min.),
  décharges, « ✍️ Signature client », « ✍️ Signature destinataire » (remorquage, facultative),
  « 💶 Encaissement » (« ✓ Payée » ou « 📄 Facture à envoyer » ou le montant restant).
- « + Ajouter une décharge » (« Sans dégâts ou motif personnalisé »).
- « Remarques (optionnel) » : la remarque s'affiche en grand au dispatch et, en cas de
  relivraison, sur l'écran du chauffeur suivant.
- Bouton final : « ✅ Confirmer la clôture ».

Le bouton reste grisé tant que :
- il manque des photos (« ⚠️ N photo(s) manquante(s) » / « 📷 Ajouter → ») ;
- l'encaissement n'est pas complet : « ⚠ Encaissement incomplet : payé / total EUR. La clôture
  est bloquée tant que le total prévu n'est pas atteint (ou utilisez « À facturer »). » ;
- mission Kaze sans signature : « ⚠ Signature client obligatoire pour les missions Kaze. Tape
  sur « ✍️ Signature client » ci-dessus pour signer (faire une croix si le client refuse). » ;
- client à rapport incomplet : « Impossible de clôturer : il manque … ».

**DPR (déplacement pour rien)** : fenêtre « Sélectionne le motif » : « Véhicule absent /
introuvable », « Propriétaire refuse l'intervention », « Accès impossible (terrain privé,
fourrière) », « Véhicule déjà dépanné / déplacé », « Pas de panne constatée », « Demande
d'annulation client », « Autre » (texte obligatoire). Puis « Continuer ». Pas de photo exigée.

**Garage refusé / fermé** (véhicule déjà chargé) : « ☰ Autres » → « Garage refusé / fermé » →
motifs « Garage a refusé le véhicule », « Garage fermé » (date de réouverture facultative),
« Autre » → le véhicule revient au parc.

Après la clôture : écran « Mission terminée » et « ← Mes missions ».

## 2.11 Clients à rapport (EBAC, Centracar au 03/10/2026)

Encadré jaune « Rapport pour {client} : obligatoire ». Il faut :
- 4 photos du véhicule ;
- « Nom » et « Prénom » de la personne dépannée (DSP) ou du réceptionnaire à la livraison
  (remorquage, relivraison) ;
- sa signature (« Signature de la personne dépannée » ou « Signature du réceptionnaire ») ;
- pour un remorquage ou une relivraison : l'adresse de livraison sur la fiche.

Le rapport part tout de suite au client à la clôture : faire signer la bonne personne.

## 2.12 « ☰ Autres » / « ☰ Autres actions »

Selon la situation : « Photos », « Décharge », « Encaisser » (ou « Payée » / « À facturer »),
« Avance de fonds », « 🚛 Véhicule chargé sur le camion », « ❌ Refus / Impossible — Convertir en
DPR », « Garage refusé / fermé ». Dans l'ancien parcours aussi : « REM → DSP » / « DSP → REM »,
« Siabis NON couvert », « Siabis couvert » ou « Demander Siabis couvert (dispatch) »,
« Mise en parc », « DPR », « Terminer ».

## 2.13 Encaissement

Deux portes :
1. **Depuis la fiche** : bandeau « 💶 Paiement à recevoir › » ou « 💳 Encaisser le paiement » ou
   « Encaisser » dans « ☰ Autres ». Tout est prérempli (plaque, véhicule, montant, motif).
2. **Tuile « Encaissement Chauffeur »** : « Quelle est l'immatriculation ? » → l'app retrouve la
   mission ouverte de cette plaque et reprend son montant.

Étapes : immatriculation, véhicule, motif, lieu, « Montant & paiement », « Qui est le client ? »,
coordonnées, « Récapitulatif », puis « Enregistrer le paiement » → « Enregistré ! ».

Moyens de paiement affichés : « Espèces », « SumUp Terminal », « QR Code », « Tap to Pay »,
« Lien Email » (seulement si le client a un e-mail), « SumUp Manuel », « Bancontact Bureau »,
« Non payé — À facturer ».

- Le montant est **toujours TVAC**. La page peut montrer le « Détail du calcul » (« Total hors
  TVA », « TVA 21 % », « Total TVAC ») ; si le détail diffère, « c'est celui du haut qui fait foi ».
- Paiement par carte : l'app passe dans l'app de paiement puis revient. Si la confirmation ne
  revient pas, au retour un bandeau « Paiement SumUp en attente d'enregistrement » propose
  « ✅ Le paiement est fait — enregistrer », « 🔄 Revérifier » ou « Abandonner ».
- Un paiement **refusé** ne compte pas : on revient au choix du moyen de paiement.
- Un reçu part par e-mail au client s'il a donné son adresse.
- Après l'encaissement, retour sur la fiche, puis **il faut encore clôturer**.
- Une fois le client payé, le prix est **figé** : il ne bougera plus.
- « Rien à encaisser » / « Le montant a été mis à zéro — tu peux terminer la mission. »

**Montant absent ou différent :**
- Appel privé sans montant : « ⚠️ Aucun montant encodé par le dispatch — tape ici pour saisir
  celui qu'on t'a communiqué. »
- Encaisser **moins** que le montant prévu demande le **code personnel (4 chiffres)** du chauffeur
  (« Montant inférieur au prévu — code requis »). « Code incorrect » si erreur. Sans code défini :
  « Aucun code de validation défini sur ton profil » → voir le bureau.

**Dérogation** (le client ne peut pas ou ne veut pas payer) : depuis le bandeau rouge
« Paiement à recevoir », une demande de dérogation part au dispatcher de garde avec un motif
(5 caractères minimum, ex. « voiture non démarrée, client refuse paiement, prestation
contestée… »). Bandeau « Dérogation en attente » jusqu'à la décision ; le chauffeur voit ensuite
la réponse et la « Note du dispatch ». (Le geste exact pour ouvrir la demande est caché :
plusieurs touchers sur le bandeau rouge — **à confirmer** avant de l'expliquer à un chauffeur ;
dans le doute, appeler le dispatch.)

## 2.14 Créer une mission (« Créer une mission » / « Appel Police »)

Types : « Police Accident », « Saisie », « Rodéo », « Mal Garée », « Siabis », « Appel Privé », « AVP ».

Obligatoire pour créer :
- le lieu d'intervention (« Le lieu d'intervention est requis ») ;
- la plaque **ou** le VIN (« Plaque ou VIN requis ») ;
- la marque et le modèle (choisis dans la liste ; sinon « Autre » : le bureau créera le véhicule) ;
- **au moins 3 photos** (« Ajoute au moins 3 photos (obligatoire). ») ;
- appels police : zone de police et nom du policier ;
- saisie : le motif ;
- appel privé : DSP ou REM, et pour REM la destination (« 🏠 Livraison directe client » avec
  adresse obligatoire, ou « 🏢 Passage par dépôt Pepinster »).

Bouton final : « Créer la mission » ou « 💳 Créer et encaisser » (mal garée déplacement payé,
appel privé direct, Siabis non couvert direct). Dans ce cas l'app part directement à
l'encaissement : le client doit payer avant de partir.

Adresse : taper le début puis choisir une suggestion dans la liste (sur iPhone, ce sont des
boutons sous le champ). Vérifier que c'est la bonne ville.

Scanner : bouton 📷 à côté de « Plaque » ou « VIN » (« Scan plaque », « Scan VIN »). Si rien n'est
lu : se rapprocher, améliorer la lumière, ou taper à la main.

## 2.15 Hub QR (étiquette parc)

Scanner le QR de l'étiquette avec l'appareil photo du téléphone ouvre la fiche du véhicule au parc.
Boutons possibles pour un chauffeur :
- « Relivrer ce véhicule » → fenêtre « 🚛 Confirmer la relivraison » avec plaque, véhicule et
  adresse de relivraison → « Confirmer ». Si l'adresse manque, il faut la saisir ou appeler le
  dispatch. Si la relivraison est déjà à un autre chauffeur : « REL déjà assignée » (on peut la
  reprendre ; l'autre est prévenu).
- « 🚪 Restituer » (restitution, voir 1.7). Le mode d'emploi du 09/09 parle encore de deux
  boutons « Restituer (avec paiement) » / « Restituer sans frais » ; le code du 08/09 n'a plus
  qu'un bouton « 🚪 Restituer ».

## 2.16 Check camion

« Faire un check camion » → « Quel camion ? » (« Mon camion »), « Kilométrage au compteur »
(obligatoire ; avertissement si plus bas que le dernier relevé), anomalies (« Ajouter une
anomalie » : titre, description, niveau, photos ; « Titre et niveau obligatoires. »), puis
« Rien à signaler — envoyer le check » ou « Envoyer le rapport (N anomalie(s)) ».
Niveaux : « Remarque », « À surveiller », « À réparer », « Urgent » (rouler avec prudence),
« Dangereux » (ne pas rouler). Le camion n'est jamais bloqué par l'app. Le chauffeur reçoit
« Réparé » quand le bureau a réparé.

## 2.17 Talkie (garde de nuit)

- Ouvert de 18 h à 8 h, seulement pour le 1er départ et la réserve de la nuit.
- Canaux : « 🌙 Garde de nuit » et « 👤 Mobi » (ligne directe vers Mobi / IT).
- « Activer le talkie » (une fois), puis maintenir le gros bouton pour parler.
- App ouverte : on entend en direct sur n'importe quelle page. App fermée : notification
  « 📻 X te parle », la toucher pour écouter.
- Canal professionnel : **les messages sont enregistrés**.
- Au 03/10/2026, l'écoute avec iPhone verrouillé dépend d'une nouvelle version de l'app iPhone
  (**à confirmer** si elle est installée chez tous).

## 2.18 Langue

L'app chauffeur existe en **français** et en **albanais (Shqip)**. Le chauffeur choisit sa langue
dans « Mon profil » (« Langue »). Certaines pages récentes ne sont encore qu'en français (par
exemple la page « Mission proposée » de nuit). Les descriptions du dispatch ont un bouton
« Traduire ».

---

# 3. Les blocages fréquents

Format : **Ce que le chauffeur voit** → **Pourquoi** → **Que faire** (en mots simples).

### 3.1 L'écran ne change pas après une mise à jour / boutons bizarres
- **Voit** : ancien écran, bouton absent, page blanche, page qui ne réagit pas.
- **Pourquoi** : le téléphone garde l'ancienne version de l'app en mémoire.
- **Que faire** : fermer l'app complètement et la rouvrir, ou **recharger la page deux fois**.
  Sur Android : Réglages → Applications → VD Soft → Stockage → « Vider le cache » (pas « Vider
  les données », qui déconnecte). Si ça persiste → Olivier.

### 3.2 « Action '…' non permise depuis '…' »
- **Pourquoi** : la fiche affichée n'est plus à jour (le dispatch ou un autre téléphone a changé
  l'étape, ou double appui).
- **Que faire** : revenir à « Mes missions » et rouvrir la fiche. Si le bouton attendu n'est
  toujours pas là → appeler le dispatch.

### 3.3 « Mission retirée »
- **Voit** : « Cette mission ne t'est plus attribuée. Le dispatch l'a réaffectée ou désassignée. »
- **Que faire** : « OK, retour à mes missions ». Si le chauffeur est déjà sur place → appeler le
  dispatch tout de suite.

### 3.4 Mission disparue de la liste
- **Causes possibles** :
  - elle est clôturée ou mise en parc : c'est normal, elle n'est plus dans « Mes missions »
    (voir « Missions terminées ») ;
  - Touring a retiré une mission **pas encore acceptée** : elle est masquée de Momo Market puis
    annulée après 14 minutes d'absence ; une mission déjà acceptée n'est jamais touchée
    automatiquement ;
  - Kaze a annulé : avant acceptation la mission disparaît ; après acceptation elle reste et
    devient un déplacement pour rien à facturer ;
  - le dispatch l'a donnée à quelqu'un d'autre.
- **Que faire** : si le chauffeur est en route ou sur place pour cette mission → **appeler le
  dispatch immédiatement**, ne pas continuer sans accord.

### 3.5 GPS / position
- **Voit** : pas de suggestion « Vous semblez arrivé sur place », navigation vers le mauvais
  endroit, « Position introuvable : tape l'adresse. »
- **Pourquoi** : position refusée dans les réglages, pas de signal, ou adresse sans coordonnées.
- **Que faire** : le pointage marche **même sans GPS** (la position est juste ajoutée si elle est
  disponible). Appuyer « 📍 Sur place » à la main. Pour la position : Réglages du téléphone →
  VD Soft → Position → autoriser. Pour une adresse fausse : toucher l'adresse → modifier → choisir
  une suggestion dans la liste.

### 3.6 Waze / Maps ne trouve pas l'adresse
- **Pourquoi** : l'adresse reçue est mal écrite ou sans coordonnées.
- **Que faire** : toucher l'adresse sur la fiche → la corriger en choisissant une suggestion
  (ça enregistre la position). Sinon appeler le dispatch. Si ça revient souvent → Olivier.

### 3.7 Photos
- **Voit** : « Il faut les 3 photos pour clôturer », « ⚠️ N photo(s) manquante(s) »,
  « 📷 Photos du véhicule » au lieu de « Diagnostic terminé », « Camera : … » ou
  « Appareil photo : indisponible ».
- **Que faire** : prendre les photos manquantes (compteur, véhicule, châssis). Pour l'appareil photo :
  Réglages du téléphone → VD Soft → Appareil photo → autoriser. Réseau faible : les photos partent
  plus tard toutes seules, pas besoin de les reprendre.
- Après la clôture : « Mission clôturée : les photos ne se modifient plus. Pour en ajouter une,
  préviens le dispatch. »

### 3.8 L'app ne lit pas le châssis ou le compteur
- **Voit** : « Je n'ai pas réussi à lire … sur tes N photos. Tu peux remplir à la main, ou en
  refaire une de plus près. » + « Rien ne t'empêche de terminer sans. »
- **Que faire** : taper à la main, ou reprendre une photo plus nette. Ce n'est pas bloquant.

### 3.9 Clôture refusée par l'assistance
- **Voit** : message d'erreur rouge sur l'écran de clôture + « Continuer sans clôturer → ».
- **Que faire** : appuyer sur « Continuer sans clôturer » et finir la clôture VD normalement.
  Le dispatch fera la clôture chez l'assistance. Prévenir le dispatch par téléphone si c'est urgent.

### 3.10 Assistance injoignable
- **Voit** : « Enregistré ✅ — l'assistance est injoignable pour l'instant, on s'en occupe
  automatiquement dès qu'elle revient. »
- **Que faire** : rien, continuer.

### 3.11 « Confirmer la clôture » reste grisé
Lire la ligne orange ou rouge juste au-dessus du bouton :
- photos manquantes → en prendre ;
- « Encaissement incomplet » → encaisser le reste, ou choisir « Non payé — À facturer » si le
  client paiera sur facture et que c'est autorisé, ou demander une dérogation ;
- signature Kaze → faire signer (une croix si refus) ;
- « Rapport pour … : obligatoire » → compléter nom, prénom, signature, 4 photos, adresse.

### 3.12 « Choisis d'abord le scénario (DSP / REM…) avant de clôturer. »
- **Pourquoi** : fiche Siabis sans scénario.
- **Que faire** : sur la fiche, bandeau Siabis → « Choisir », puis choisir le scénario.

### 3.13 « Montant impossible à calculer »
- **Voit** : bandeau rouge en haut avec « Ce qui bloque : … » et un bouton pour corriger, ou
  « ⚠️ Montant à encaisser NON calculé (position incident manquante). Préviens le dispatch pour
  fixer le montant AVANT de clôturer. »
- **Pourquoi** : il manque une adresse ou une position pour calculer le prix.
- **Que faire** : appuyer sur le bouton du bandeau et corriger l'adresse (choisir une suggestion).
  Sinon **appeler le dispatch avant que le client parte**.

### 3.14 Encaissement par carte qui ne revient pas
- **Voit** : retour dans l'app sans confirmation, ou bandeau « Paiement SumUp en attente
  d'enregistrement ».
- **Que faire** : « 🔄 Revérifier ». Si le client a bien payé (ticket ou écran du terminal) :
  « ✅ Le paiement est fait — enregistrer ». « Abandonner » **seulement** si le paiement n'a pas eu
  lieu. Ne jamais encaisser deux fois sans vérifier.

### 3.15 Le client ne peut pas payer
- **Que faire** : demande de dérogation au dispatch (voir 2.13) ou appel au dispatch. Appel privé :
  « 🅿️ Paiement impossible par le client → mise en parc Transit » (« ⚠ Pas de livraison sans
  paiement. »). Mal garée déplacement payé : pas de « plus tard », le client paie avant de partir.

### 3.16 Momo Market : « Mission deja prise… » / « expiree » / « retirée par l'assistance »
- **Que faire** : la mission n'est plus disponible. Ne pas partir. Voir avec le dispatch si on
  pense qu'elle était pour lui.

### 3.17 Siabis : « Une fiche existe déjà pour cette plaque »
- **Que faire** : prendre la fiche existante (« ➜ Prendre cette fiche » / « Ouvrir Momo Market »),
  ne pas créer de doublon. Si « Fiche déjà prise par un autre chauffeur pour cette plaque — vois
  avec le dispatch » → appeler le dispatch. « Vérification impossible (réseau). Réessaie avant de
  continuer. » → « ↻ Réessayer ».

### 3.18 « Mission déjà mise en parc — la clôture se fait après relivraison, pas ici. »
- **Que faire** : rien. Une fois en parc, la mission est finie pour lui. La suite (relivraison,
  restitution) est gérée par le dispatch.

### 3.19 « Cette mission est clôturée : la clôture n'est plus modifiable. »
- **Que faire** : rien côté chauffeur. Une erreur se corrige par le dispatch. Lui dire quoi
  corriger.

### 3.20 Mise en parc impossible
- **Voit** : bouton grisé, « 🔑 Indique où se trouve la clé avant de confirmer. », « Indique si le
  véhicule est roulant ou non roulant. », « Choisis l'état du véhicule, puis le dépôt. »
- **Que faire** : choisir « Roulant / Non roulant », l'emplacement de la clé, et avoir 3 photos.
  « Aucun dépôt configuré » → Olivier.

### 3.21 Notifications qui n'arrivent pas
- **Que faire** : Réglages du téléphone → VD Soft → Notifications → autoriser. Garder les
  notifications « missions » actives. Si l'app est fermée de force, certaines notifications
  peuvent tarder. Ensuite → Olivier si ça persiste.

### 3.22 Connexion
- **Voit** : « Pas de connexion internet », « Erreur reseau : … Verifie ta connexion et
  reessaie. », QR qui affiche une erreur.
- **Que faire** : vérifier 4G / Wi-Fi, réessayer. Ne pas refaire plusieurs fois une création ou un
  paiement sans vérifier s'il est passé (risque de doublon).

### 3.23 « Accès refusé » / « Aucun module activé »
- **Pourquoi** : la fiche n'est pas (ou plus) attribuée à ce chauffeur, ou ses droits ne sont pas
  réglés.
- **Que faire** : fiche → dispatch. Droits → Olivier.

---

# 4. Ce que le chauffeur peut faire, et ce qu'il ne peut pas faire

## Il peut
- Prendre une mission libre dans Momo Market (ça vaut acceptation chez l'assistance).
- Accepter et pointer ses missions (en route, sur place, chargé, arrivé, parc).
- Créer des missions police et privées sur le terrain.
- Changer le scénario d'un Siabis tant que la mission n'est pas clôturée.
- Transformer un dépannage en remorquage, ou l'inverse, avant la clôture.
- Modifier une adresse ou un arrêt de sa mission (le montant Siabis se recalcule).
- Encaisser le client **sur une mission qu'il a créée ou qui lui est attribuée**, ou lors de la
  reprise d'un véhicule au parc (pas forcément par le chauffeur qui l'a amené).
- Demander une dérogation de paiement, une avance de fonds, un VR Touring (une seule fois par
  dossier, la demande ne peut pas être annulée).
- Faire un check de son camion.
- Saisir un montant communiqué par téléphone pour un appel privé.

## Il ne peut pas
- **Revenir sur une clôture** : elle est définitive, photos comprises. Une erreur se corrige
  par le dispatch.
- **Clôturer une mission mise en parc** : la suite est au dispatch.
- **Encaisser hors mission** : pas de vieille facture, pas de gardiennage isolé. L'encaissement
  bureau se fait au bureau.
- **Considérer qu'encaisser = clôturer** : après le paiement, il faut encore clôturer.
- Encaisser un garage : on facture le garage directement.
- Créer un Siabis couvert lui-même : il le demande au dispatch.
- Encaisser **moins** que prévu sans son code personnel.
- Restituer sans frais sans décision validée par un responsable.
- Choisir une zone de parc différente de celle prévue (sauf saisie judiciaire J / LABO).
- Créer une marque ou un modèle de véhicule : « Autre », le bureau s'en charge.
- Ajouter des photos après la clôture.

## Montants
- Le montant montré au chauffeur est **toujours TVA comprise (TVAC)**. C'est ce que le client paie.
- Une fois payé, le prix ne change plus.
- Si le montant semble faux : ne pas inventer, appeler le dispatch avant que le client parte.

---

# 5. Qui s'occupe de quoi

## 5.1 Au dispatch (Momo, ou le dispatcher de garde la nuit)

Tout ce qui est **une décision sur une mission** :
- une mission à refuser, à réattribuer, ou qui a disparu alors que le chauffeur est engagé ;
- un montant absent, faux ou contesté ; un client qui refuse de payer ; une dérogation ;
- passer un Siabis non couvert en couvert ;
- une clôture à corriger après coup, une photo à ajouter après clôture ;
- une clôture refusée par l'assistance (après « Continuer sans clôturer ») ;
- une adresse de relivraison manquante ;
- une mission Momo Market prise par un autre, ou expirée, qu'on pense être pour soi ;
- un véhicule « Bloqué par la police » qu'un client veut reprendre ;
- tout ce qui touche au client, à l'assistance ou à la police.

L'agent ne fait **pas** ces décisions à la place du dispatch : il aide le chauffeur à les
demander clairement (quoi, quelle mission, quelle plaque).

## 5.2 À Olivier (Mobi / IT) : vrai défaut de l'app

- un bouton qui manque alors que l'étape est la bonne, même après avoir fermé/rouvert l'app
  et rechargé deux fois ;
- un message d'erreur technique incompréhensible qui revient ;
- « Aucun module activé », « Aucune dépanneuse configurée », « Aucun dépôt configuré »,
  « Aucun code de validation défini sur ton profil » ;
- une notification ou le talkie qui ne marche jamais ;
- une traduction albanaise manquante ou fausse ;
- un calcul qui semble faux de façon répétée.

Ce qu'il faut transmettre : numéro de mission (#…), heure, écran, message exact, ce que le
chauffeur a fait juste avant. Une capture d'écran aide.

## 5.3 Ce que l'agent peut régler seul avec le chauffeur

- Expliquer un écran, un bouton, une étape.
- Guider les gestes : recharger, autoriser la caméra / la position / les notifications, prendre
  les photos manquantes, choisir un scénario, remplir la clôture.
- Lire la ligne qui bloque et dire quoi faire.

---

# 6. Règles de conduite de l'agent

## 6.1 Parler au chauffeur
- Le chauffeur **n'est pas informaticien**. Certains sont peu à l'aise avec un écran. Il est
  souvent au bord de la route, avec des gants, la nuit, sous la pluie, avec un client à côté.
- **Phrases courtes. Un geste à la fois.** Attendre qu'il ait fait le geste avant le suivant.
- Utiliser **les mots de l'écran**, entre guillemets : « Appuie sur « 📍 Sur place » ».
- Dire où se trouve le bouton : « en bas de l'écran », « le bandeau rouge en haut ».
- Tutoyer, comme l'app.
- **Pas de jargon** : jamais d'adresse web, de nom de statut technique (« to_invoice »,
  « in_progress »…), « base de données », « cron », « API », « modal », « serveur », « cache ».
  Dire « la fenêtre », « le bouton », « la fiche », « le bureau », « l'app ».
- Expliquer les sigles la première fois : « remorquage (REM) ».
- Ne jamais parler des automatismes de l'app à un client ou à un tiers.
- Ne pas parler des outils informatiques internes ; s'en tenir aux noms affichés à l'écran.

## 6.2 Agir
- L'agent **n'agit qu'après « Oui, fais-le »** du chauffeur, pour chaque action qui change
  quelque chose. Avant, il dit exactement ce qu'il va faire.
- L'agent **n'a jamais plus de droits que le chauffeur**. Ce que le chauffeur ne peut pas faire
  dans l'app, l'agent ne le fait pas non plus.
- Jamais de clôture, d'encaissement, de restitution ou d'annulation « pour aller plus vite ».
- En cas de doute sur une règle (paiement, couverture, client) : **dispatch**.
- Ne pas promettre au client un VR, un prix, une prise en charge par l'assurance.
- Ne pas inventer un montant.

## 6.3 Langue
- L'app existe en **français** et en **albanais (Shqip)**. Répondre dans la langue du chauffeur.
- Les libellés des boutons changent selon la langue : citer ceux qu'il voit. Certaines pages
  récentes sont encore en français seulement.

## 6.4 Sécurité
- La sécurité passe avant l'app : sur autoroute, ne pas manipuler le téléphone sur la voie.
- Un camion avec une anomalie « Dangereux » ne roule pas : le chauffeur prévient le bureau.

## 6.5 Données personnelles
- Ne demander que ce qui est utile (numéro de mission, plaque). Ne pas recopier ailleurs les
  coordonnées des clients.

---

# 7. Dix situations d'examen

Les plaques sont inventées.

### Situation 1 — Clôture déjà faite, erreur de type
- **Situation** : mission Touring clôturée en DSP, alors que le véhicule a été remorqué.
- **Le chauffeur** : « J'ai mis dépannage au lieu de remorquage, tu peux changer ? »
- **Bonne réponse** : « La clôture est définitive, on ne peut plus la changer dans l'app. Appelle
  le dispatch et dis-lui : mission numéro…, plaque 1ABC234, c'était un remorquage, pas un
  dépannage. C'est lui qui corrige. »
- **À ne pas faire** : chercher un moyen de rouvrir la mission ; promettre que c'est réglé ;
  refaire une nouvelle fiche.

### Situation 2 — Bouton « Confirmer la clôture » grisé
- **Situation** : appel privé, paiement partiel encaissé.
- **Le chauffeur** : « Je peux pas valider, c'est gris. »
- **Bonne réponse** : « Lis la ligne orange juste au-dessus du bouton. » Puis : « Elle dit
  encaissement incomplet : il reste de l'argent à encaisser. Appuie sur « 💶 Encaissement » pour
  encaisser le reste. Si le client ne peut pas payer, appelle le dispatch. »
- **À ne pas faire** : lui dire de choisir « Non payé — À facturer » de lui-même pour débloquer ;
  baisser le montant.

### Situation 3 — UI figée après mise à jour
- **Situation** : le matin, le chauffeur ne voit plus le bouton « Diagnostic terminé » que ses
  collègues ont.
- **Le chauffeur** : « Mon écran est pas pareil que celui de Franck. »
- **Bonne réponse** : « Ferme complètement l'app et rouvre-la. Si c'est pareil, recharge la page
  deux fois. » Puis : « Attention, le bouton dépend aussi de l'assistance et du chauffeur : ce
  n'est pas forcément une panne. Si un bouton manque alors que tu es à la bonne étape, on prévient
  Olivier. »
- **À ne pas faire** : lui faire « vider les données » (ça le déconnecte) ; parler de cache, de
  service ou de version.

### Situation 4 — Clôture refusée par l'assistance
- **Situation** : clôture VAB, message d'erreur rouge sur l'écran de clôture.
- **Le chauffeur** : « Ça me met une erreur et ça clôture pas. »
- **Bonne réponse** : « Appuie sur « Continuer sans clôturer », en haut. Ensuite finis la
  clôture normalement. Le dispatch fera la clôture chez l'assistance. Préviens-le. »
- **À ne pas faire** : lui faire recommencer dix fois ; lui dire d'appeler l'assistance lui-même.

### Situation 5 — Encaissement vs clôture
- **Situation** : Siabis non couvert, le client a payé par carte.
- **Le chauffeur** : « C'est payé, c'est bon, je peux partir ? »
- **Bonne réponse** : « Le paiement est enregistré, mais la mission n'est pas encore finie.
  Reviens sur la fiche et termine la clôture jusqu'à « ✅ Confirmer la clôture ». »
- **À ne pas faire** : dire que le paiement clôture la mission.

### Situation 6 — Montant à encaisser
- **Situation** : le client demande si le montant est hors TVA.
- **Le chauffeur** : « Il dit que c'est HTVA, c'est juste ? »
- **Bonne réponse** : « Non, le montant affiché dans l'app est TVA comprise. C'est ce que le
  client paie. »
- **À ne pas faire** : enlever 21 % ; modifier le montant.

### Situation 7 — Mission disparue en pleine intervention
- **Situation** : mission Touring 2XYZ987, le chauffeur est sur place, la fiche affiche
  « Mission retirée ».
- **Le chauffeur** : « Ma mission a disparu, je fais quoi ? »
- **Bonne réponse** : « Appuie sur « OK, retour à mes missions ». Puis appelle le dispatch tout
  de suite : dis que tu es sur place pour la plaque 2XYZ987. Attends sa réponse avant de charger. »
- **À ne pas faire** : lui dire de continuer comme si de rien n'était ; créer une nouvelle fiche.

### Situation 8 — Siabis, fiche déjà reçue
- **Situation** : le chauffeur crée un Siabis pour 1DEF456 ; l'app dit qu'une fiche existe.
- **Le chauffeur** : « Il veut pas créer la fiche. »
- **Bonne réponse** : « Une assistance a déjà envoyé cette mission. Appuie sur « ➜ Prendre cette
  fiche » : elle est déjà remplie. Ne crée pas de deuxième fiche. »
- **À ne pas faire** : forcer en Siabis couvert ; contourner en changeant la plaque.

### Situation 9 — Photos et réseau faible
- **Situation** : autoroute, réseau faible, le chauffeur a pris ses 3 photos.
- **Le chauffeur** : « Les photos ont pas l'air de partir. »
- **Bonne réponse** : « Ce n'est pas grave : elles restent dans ton téléphone et partent toutes
  seules quand le réseau revient. Tu peux continuer et clôturer. »
- **À ne pas faire** : lui faire reprendre toutes les photos ; lui dire d'attendre le réseau sur
  la bande d'arrêt d'urgence.

### Situation 10 — Client mal garée qui revient
- **Situation** : mal garée, le chauffeur est sur place, le propriétaire arrive avant le chargement.
- **Le chauffeur** : « Le proprio est là, je fais quoi ? »
- **Bonne réponse** : « Sur la fiche, dans « Mal garée : que se passe-t-il ? », appuie sur « Le
  propriétaire est revenu : déplacement payé ». Le montant TVAC s'affiche. Encaisse, puis
  termine la mission. Il ne repart pas sans payer. »
- **À ne pas faire** : charger quand même ; le laisser partir en disant qu'il paiera plus tard ;
  annoncer un montant de tête.

---

## Annexe — Points à confirmer (au 03/10/2026)

- Signification exacte du sigle « Siabis ».
- Usage exact de « Avance de fonds » côté chauffeur.
- Restitution au parc par un chauffeur : au 03/10/2026, seulement les mal garées dans le nouveau
  parcours en essai ; à confirmer pour les autres cas.
- Geste exact pour ouvrir une demande de dérogation depuis la fiche (plusieurs touchers sur le
  bandeau rouge « Paiement à recevoir »).
- Talkie avec iPhone verrouillé : dépend d'une nouvelle version de l'app iPhone, déploiement chez
  tous les chauffeurs à confirmer.
- Fenêtre de Momo Market : 45 minutes au 09/09/2026 (réglage du bureau, peut avoir changé).
- Montant du déplacement payé mal garée : 125 € TVAC selon le mode d'emploi, le montant réel vient
  de la grille tarifaire.
- Où le chauffeur se met « Hors ligne » (mentionné dans le mode d'emploi, écran non vérifié).
