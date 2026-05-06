# Spec UX — Dispatch + Mission Chauffeur

**Projet :** Verviers Dépannage App (HOOS)
**Version :** 1.0 — Spec fondatrice
**Date :** Mai 2026
**Auteur :** Olivier Herman + Claude (cadrage assisté)
**Statut :** Référence pour tous les chantiers UI dispatch et chauffeur

---

## Comment lire ce document

Ce document n'est pas un mockup figé. C'est une **constitution UX** :
- Tu y reviens à chaque fois qu'un nouveau chantier UI commence
- Tu le colles à Claude Code (ou tu pointes vers son chemin) avant de demander une refonte d'écran
- Tu le mets à jour quand une décision change (et tu commit le changement)
- Quand tu dupliqueras le repo pour un autre client en multi-tenant, ce doc te dira **ce qui est figé** et ce qui peut varier

Toute décision contraire à ce qui est ici doit faire l'objet d'une discussion explicite — pas une décision improvisée pendant le code.

---

## 1. Personas et contexte d'usage

### 1.1 Persona principal : le dispatcher

**Profil :**
- Travaille en équipe : 3+ dispatchers en parallèle, tous interchangeables
- Pas de spécialisation : chacun peut traiter Touring, Police, Privé, etc.
- Connaît ses chauffeurs par cœur
- Travaille sous pression pendant les pics (2-3 par jour)

**Volume de travail :**
- 20-50 missions/jour (50% Touring/assistances)
- 10+ missions actives en parallèle à chaque instant
- Délai cible mail → assignation chauffeur : 1-2 minutes
- Retour sur l'app toutes les 15-30 min en journée

**Contexte d'usage :**
- **Jour :** poste fixe, écran desktop, plusieurs onglets ouverts (Odoo, mail, app)
- **Soir/weekend :** tel mobile en backup
- L'app n'est jamais en focus exclusif → notifs sonores et push agressives nécessaires

**Frustrations connues (pain points) :**
- Avec TowSoft : devis manuel ligne par ligne, pas d'historique chauffeur, pas de timeline
- Avec l'app actuelle : pas de pipeline avec compteurs, pas de devis intégré, actions Odoo externalisées

### 1.2 Persona secondaire : le chauffeur

**Profil :**
- Sur le terrain, mobile uniquement (PWA installée sur tel)
- Travaille sous tous les contextes : plein soleil, nuit, pluie, mains sales
- 1 mission active à la fois (rare exception : multi-stops dans une seule mission)

**Cas d'usage :**
- Reçoit notif push → ouvre fiche → enchaîne actions (J'accepte → En route → Sur place → Photos → Terminé)
- Crée parfois ses propres missions (Police uniquement aujourd'hui)
- Encaisse client si paiement requis

**Voir aussi :** spec DSP figée dans userMemories, doc séparé recommandé pour le détail Mission Chauffeur.

### 1.3 Persona tertiaire : le superadmin (Mobi/Olivier)

- Accès à tout, partout
- Reçoit alertes mail+push (solde caisse négatif, sync Odoo erreurs, TowSoft errors)
- Gère la configuration (users, depots, modules, etc.)

---

## 2. Architecture des 3 niveaux de vue

L'app dispatch s'organise en **3 niveaux hiérarchiques** :

### Niveau 1 — Pipeline (vue globale du jour)

**Question répondue :** "Qu'est-ce que je dois faire aujourd'hui ?"

**Forme :** Onglets en haut avec compteurs live, chaque onglet = un état du pipeline.

**Onglets (inspirés de TowSoft mais simplifiés) :**
1. `Nouveau` — missions parsées par l'IA, en attente de confirmation dispatcher
2. `À assigner` — confirmées, pas encore de chauffeur
3. `En cours` — chauffeur assigné, en route ou sur place
4. `En parc` — véhicules garés sur nos terrains, en attente de relivraison
5. `À facturer` — missions terminées, devis à valider et envoyer
6. `Terminé` — facturées, archivées (visible mais en arrière-plan visuel)

Chaque onglet affiche un **compteur en pastille rouge** quand > 0 (recalcul live via realtime Supabase).

**Comportement :**
- Au chargement : ouvre l'onglet `Nouveau` par défaut (où l'action est demandée)
- Si `Nouveau = 0` : ouvre `À assigner`
- Si `À assigner = 0` : ouvre `En cours`
- Click sur onglet → liste filtrée

**Hiérarchie visuelle des onglets :**
- Onglet actif : fond rouge marque (#XX0000), texte blanc
- Onglet avec compteur > 0 : pastille rouge à droite du nom
- Onglet calme : fond noir, texte gris clair

### Niveau 2 — Carte / Dashboard temps réel

**Question répondue :** "Où sont mes équipes maintenant ?"

**Forme :** Carte interactive (Google Maps) avec deux types de pins :
- **Pins missions** : couleur selon l'état (vert OK, jaune en route, orange sur place, rouge bloqué)
- **Pins chauffeurs** : initiales du chauffeur, couleur selon disponibilité (vert dispo, jaune en mission, gris hors service)

**Bandeau supérieur :** liste des chauffeurs en service avec leur statut + click pour modal toggle.

**Toggle entre Niveau 1 et Niveau 2 :** un bouton/icône permet de basculer entre vue Pipeline et vue Carte. Le dispatcher choisit selon ce qu'il fait.

### Niveau 3 — Fiche mission (détail)

**Question répondue :** "Que fait cette mission précise ?"

**Forme :** Page dédiée avec sections empilables.
**Détail complet :** voir section 4 ci-dessous.

---

## 3. Hiérarchie visuelle et palette

### 3.1 Couleurs marque

| Couleur | Hex | Usage |
|---|---|---|
| **Rouge marque** | `#DC2626` (Tailwind red-600) | Logo, CTA principal, header actif |
| **Noir** | `#0F172A` (Tailwind slate-900) | Fond dark mode, texte titres |
| **Blanc** | `#FFFFFF` | Fond light mode, texte sur fond sombre |

### 3.2 Palette sémantique (séparée de la marque)

Pour éviter les conflits "rouge marque vs rouge urgence", on utilise une **palette sémantique** distincte :

| État | Couleur | Hex | Usage |
|---|---|---|---|
| **Succès / OK** | Vert | `#16A34A` (green-600) | Mission terminée, adresse confirmée, chauffeur dispo |
| **Attention** | Jaune | `#EAB308` (yellow-500) | En attente, en cours, < 30 min âge |
| **Urgence modérée** | Orange | `#EA580C` (orange-600) | Mission > 30 min sans assignation, mise en parc |
| **Urgence critique** | Rouge alerte | `#B91C1C` (red-700) avec **clignotement** | Mission > 60 min sans action, alerte solde caisse |
| **Info** | Bleu | `#2563EB` (blue-600) | Status info, badge IA, source Touring |
| **Inactif** | Gris | `#64748B` (slate-500) | Mission archivée, chauffeur hors service |

### 3.3 Typographie

- **Police :** système (San Francisco / Inter) — pas de webfont custom
- **Tailles :**
  - `text-xs` (12px) : badges, métadonnées
  - `text-sm` (14px) : texte courant des listes
  - `text-base` (16px) : texte des fiches
  - `text-lg` (18px) : titres de section
  - `text-2xl` (24px) : titre de fiche mission
  - `text-3xl` (30px) : compteurs pipeline (les chiffres en gros)

### 3.4 Mode sombre vs clair

**Décision :** Light mode par défaut + dark optionnel via toggle utilisateur.

**Raisons :**
- Chauffeurs souvent dehors au soleil → light obligatoire pour eux
- Dispatcher de nuit en cabine → dark utile
- Le client voit l'écran lors d'un encaissement → light = lecture immédiate

**Implémentation Tailwind :** chaque classe avec son équivalent `dark:*`. Pas de couleurs hardcodées.

**Statut actuel :** chantier prévu après refonte mobile + audit des couleurs hardcodées. Voir section 10.

---

## 4. Spec détaillée — Fiche mission (Niveau 3)

C'est l'écran le plus utilisé. On le décortique en zones.

### 4.1 Zone 1 — Header (sticky)

**Contenu :**
- Bouton retour (←)
- Badge source (TOURING / POLICE / PRIVÉ / etc.) en couleur sémantique
- Titre : `Mission [N° mission]`
- Sous-titre : `[N° dossier] • [Statut courant]`
- À droite : `Reçu le [date]` + badge `IA [confiance %]` si parsing auto

**Hauteur :** 80px max
**Comportement :** sticky en haut, visible toujours

### 4.2 Zone 2 — Bandeau d'alertes (conditionnel)

Apparaît uniquement si conditions remplies :

- **Banderole rouge sticky :** "À encaisser : XXX €" si `amount_to_collect > 0`
- **Banderole jaune :** "Adresse non confirmée par Google" si l'adresse parsée par l'IA n'a pas été validée
- **Banderole orange :** "Cette mission est suivie par [Nom dispatcher]" si présence Realtime détectée d'un autre dispatcher éditant en même temps (anti-conflit)

Position : juste sous le header, prend toute la largeur.

### 4.3 Zone 3 — Bloc d'actions principal (sidebar droite desktop / sticky bottom mobile)

**C'est la zone d'action critique.** Elle remplace le single button "Ouvrir Odoo" actuel.

**Statut actuel** affiché en haut : badge couleur sémantique selon état mission.

**Action principale (CTA gros bouton rouge) :** dépend de l'état :

| État mission | CTA principal |
|---|---|
| `Nouveau` (parsed) | "Confirmer la mission" |
| `Confirmé sans chauffeur` | "Assigner un chauffeur" |
| `En cours` (chauffeur assigné) | "Modifier" (pas d'action urgente) |
| `Terminé sans devis` | "Générer le devis" |
| `Devis brouillon` | "Valider et envoyer la facture" |
| `Facturé` | (pas de CTA, état final) |

**Actions secondaires (boutons plus petits, en dessous) :**

Toujours visibles (selon état) :
- 🅿️ Mise en parc (visible si en cours, charger véhicule)
- 🔄 Transformer DSP → REM (visible si type=DSP, en cours)
- 👤 Changer le chauffeur (visible si assigné)
- ✏️ Modifier la destination (visible si en cours, avant arrivée)
- 🚐 Créer une REL (visible si statut "en parc")
- ❌ Annuler la mission (visible si pas terminée — modal de confirmation requise)
- 🖨️ Imprimer / envoyer (étiquette, décharge, facture — selon état)
- 🔗 Lier à une autre mission (rare mais utile)

**Règle :** ces 8 actions sont en **1er niveau** (pas dans un menu kebab). Elles peuvent être désactivées (grisées) selon l'état mais toujours visibles.

**Bouton Sauvegarder :** rouge, gros, sticky en bas de la sidebar. Apparait dès qu'un champ est édité (état "dirty").

### 4.4 Zone 4 — 7 infos critiques (au-dessus du fold)

**Décision verrouillée :** ces 7 infos doivent être visibles **immédiatement** sans scroll, sur 1 écran desktop (1440x900).

| # | Info | Source | Affichage |
|---|---|---|---|
| 1 | **Type d'intervention** | DSP/REM/REL/etc. | Badge gros, couleur sémantique |
| 2 | **Plafond €** | `amount_to_collect` ou montant assistance | Chiffre gros, vert si > 0 |
| 3 | **Plaque** | `plate` | Texte gros, monospace |
| 4 | **Lieu d'incident** | `incident_address` | Adresse complète + check Google ✓ |
| 5 | **Destination** | `destination_address` | Adresse complète + check Google ✓ |
| 6 | **Client / Source** | `source` (TOURING/POLICE/etc.) | Badge couleur sémantique |
| 7 | **Type de panne** | `incident_type` | Texte court (ex: "transmission") |

**Layout desktop :** grille 2 colonnes ou 3 colonnes selon largeur.
**Layout mobile :** empilement vertical, chaque info dans une carte ou ligne distincte.

### 4.5 Zone 5 — Champs détaillés (sous le fold)

Sections dans l'ordre :

1. **Intervention** : type, type d'incident, description
2. **Client facturé** : recherche Odoo (anti-doublon), nom/raison sociale
3. **Client assisté** (personne en panne) : nom, téléphone, adresse domicile
4. **Véhicule** : lien Odoo véhicule, plaque, marque, modèle, carburant, BV, VIN
5. **Lieu d'intervention / Destination** : adresses complètes avec validation Google
6. **Stops intermédiaires** : ajouter/retirer/réorganiser (drag & drop si possible)
7. **Montants** : montant garanti HTVA, paiement à réclamer client
8. **Frais et charges (devis Odoo intégré)** ⚠️ NOUVEAU vs actuel — voir section 5
9. **Compte rendu de mission** : photos chauffeur (3+), notes structurées
10. **Notes internes** : notes Bureau, notes Chauffeur, notes Facture (3 zones distinctes)

### 4.6 Zone 6 — Sidebar droite (suivi temps réel)

**Décision verrouillée :** garder ce qui marche déjà bien dans l'app actuelle.

- **Statut courant** (badge gros)
- **Dépôt de départ** (dropdown, défaut Pepinster)
- **Assignation chauffeur** (dropdown ou suggestion 1-clic)
- **Suivi chauffeur** : timeline horodatée des étapes (Assignée 22:48 → Acceptée 22:48 → En route → Sur place → Mis en parc → Terminée)
- **Photos chauffeur** : grille 3+ photos
- **Référence** : N° mission, N° dossier, source, date reçu, date incident
- **Dossier Odoo** : bouton "Ouvrir le dossier Odoo ↗" (mais avec auto-création préalable)
- **Historique** : log chronologique de toutes les actions sur cette mission (qui a fait quoi quand)

### 4.7 Présence et concurrence (REALTIME OBLIGATOIRE)

**Décision verrouillée :** plusieurs dispatchers peuvent être sur la même fiche en même temps. L'UX doit gérer ça proprement.

**Mécanisme :**
- Subscription Supabase Realtime sur `incoming_missions` filtré par `id`
- Subscription supplémentaire sur une table `mission_presence` (id, mission_id, user_id, last_seen) avec heartbeat toutes les 30s
- Quand un dispatcher ouvre une fiche : INSERT/UPDATE dans `mission_presence`
- Quand il quitte : DELETE
- Quand il est inactif > 60s : nettoyage par cron

**UI :**
- Bandeau orange en haut : "Marc consulte cette fiche en ce moment"
- Si Marc édite un champ : ce champ s'affiche avec une bordure orange + tooltip "Marc édite"
- Si conflit (2 personnes sauvent en même temps) : modal "Marc a sauvé entre-temps. Voulez-vous écraser ses modifications ou recharger la fiche ?"

**Verrouillage soft :** pas de lock dur côté DB. La logique est **last write wins** mais l'UI prévient.

---

## 5. Spec détaillée — Frais et charges (devis Odoo intégré)

C'est **le plus gros manque** de l'app actuelle vs TowSoft. À designer avec soin.

### 5.1 Comportement à la confirmation mission

Quand le dispatcher clique "Confirmer la mission" :
1. Création auto Helpdesk ticket Odoo
2. Création auto FSM Task associée
3. Création auto **devis brouillon** dans Odoo, basé sur :
   - Type d'intervention (REM → ligne TOUREM, DSP → ligne TOURDSP, etc.)
   - Source (Touring → tarifs Touring, Mondial → tarifs Mondial, etc.)
   - Distance estimée (Google Distance Matrix entre incident et destination)

### 5.2 Affichage du devis dans la fiche

Section **Frais et charges** intégrée à la fiche mission (pas un modal externe).

**Format tableau :**

| Code | Description | Quantité | Montant unitaire | Total |
|---|---|---|---|---|
| TOUREM | TOURING - REMORQUAGE | 1 | 66.30 € | 66.30 € |
| TOUKMSREM | TOURING - KILOMÈTRES SUPPLÉMENTAIRES (20 KM INCLUS) | 64 | 1.32 € | 84.48 € |
| TOUMAJ1907 | TOURING - MAJORATION 19h-7h (35%) | 0 | 0.00 € | 0.00 € |
| TOUMAJWEJF | TOURING - MAJORATION WEEK-END/JF (35%) | 0 | 0.00 € | 0.00 € |
| | | | **S-Total** | **150.78 €** |
| | | | **TVA 21%** | **31.66 €** |
| | | | **TOTAL** | **182.44 €** |

**Interactions :**
- Quantité éditable (input number)
- Possibilité d'ajouter une ligne ad-hoc (bouton "+ Ajouter une ligne")
- Possibilité de supprimer une ligne (icône poubelle, sauf lignes auto qui sont grisées)
- Recalcul auto du total à chaque modif
- Bouton "Rafraîchir depuis Odoo" si le devis a été modifié dans Odoo en parallèle

### 5.3 Mapping mission → lignes devis (à figer plus tard)

Cette table de mapping est métier, à co-construire avec Olivier :

| Type intervention | Source | Lignes devis auto |
|---|---|---|
| DSP | TOURING | TOURDSP (forfait) + TOURKMS si > 25km + majorations selon heure |
| REM | TOURING | TOUREM (forfait) + TOUKMSREM (par km au-dessus de 20 inclus) + majorations |
| REL | TOURING | TOURREL (forfait) + km supplémentaires |
| DPR (déplacement pour rien) | TOURING | TOURDPR (forfait réduit) |

**À compléter par Olivier :** ouvrir un devis Touring récent dans Odoo et lister les lignes types pour chaque scénario. Cette table sera la base de la logique auto-devis.

---

## 6. Spec détaillée — Pipeline (Niveau 1)

### 6.1 Layout desktop

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Logo VD]  [Recherche...]            [Vue Pipeline | Carte] [Profil] │
├──────────────────────────────────────────────────────────────────────┤
│ Nouveau (3)  À assigner (2)  En cours (10)  En parc (45)  À facturer (8)  Terminé │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Filtres : [Source ▼] [Chauffeur ▼] [Date ▼]    [+ Nouvelle mission]│
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ [Card mission 1]                                               │ │
│  ├────────────────────────────────────────────────────────────────┤ │
│  │ [Card mission 2]                                               │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 6.2 Layout mobile

- Onglets : scroll horizontal en haut (compteurs visibles)
- Filtres : icône entonnoir → modal
- Cards : empilement vertical, chaque card = 1 mission (pas de tableau)

### 6.3 Card mission (composant réutilisable)

**Contenu d'une card :**

```
┌────────────────────────────────────────────────────────┐
│ [Badge TOURING] N° Mission  •  N° Dossier              │ ← Header
│                                              [Âge: 23m]│
├────────────────────────────────────────────────────────┤
│ 🚗 Plaque [1CTQ676]  Renault Kangoo                    │
│ 📍 Pl. du Village 10, 4141 Sprimont                    │
│ ➡️ Rue Lefin 12, 4860 Pepinster                        │
│ 💶 À encaisser : 0 €  |  Plafond : 200 €               │
├────────────────────────────────────────────────────────┤
│ [👤 Mobi]  [▶ Sur place 22:49]                  [⚡]  │ ← Footer
└────────────────────────────────────────────────────────┘
```

**Code couleur âge** (sur le coin haut-droit ou sur la bordure entière) :
- Vert : < 15 min
- Jaune : 15-30 min
- Orange : 30-60 min
- Rouge clignotant : > 60 min

**Action rapide ⚡** sur cards "À assigner" : bouton qui ouvre directement le modal d'assignation (1 clic).

**Click sur la card** : ouvre la fiche mission complète (Niveau 3).

---

## 7. Spec détaillée — Vue Carte (Niveau 2)

### 7.1 Layout

- Carte Google Maps prend 70% de la hauteur
- Bandeau supérieur : liste horizontale des chauffeurs en service (avec photo/initiales + statut)
- Bandeau inférieur (collapsible) : liste des missions affichées sur la carte (synchronisée avec les pins)

### 7.2 Pins missions

- Couleur : selon état (vert/jaune/orange/rouge selon âge ou priorité)
- Forme : icône camion ou pin standard
- Click : popup avec résumé mission + bouton "Ouvrir la fiche"
- Si plusieurs missions au même endroit : cluster (Google Maps native)

### 7.3 Pins chauffeurs

- Forme : cercle avec initiales du chauffeur (ex: "JT" pour Jonathan)
- Couleur : vert dispo, jaune en mission, gris hors service
- Click : popup avec :
  - Nom complet
  - Statut courant
  - Dernière position connue
  - ETA vers une mission sélectionnée (si applicable)
  - Bouton "Assigner cette mission à [Nom]"

### 7.4 Bandeau chauffeurs (haut)

- Click sur un chauffeur : ouvre modal toggle Garde Jour/Nuit
- Indicateur visuel "En service" / "Hors service" / "En mission"

---

## 8. Mapping des actions selon contexte

Décision verrouillée : certaines actions sont accessibles aux 2 acteurs (dispatcher + chauffeur), d'autres sont spécifiques.

| Action | Dispatcher | Chauffeur | Notes |
|---|---|---|---|
| Confirmer mission | ✅ | ❌ | Dispatcher seulement |
| Assigner chauffeur | ✅ | ❌ | Dispatcher seulement |
| Accepter mission | ❌ | ✅ | Chauffeur seulement |
| En route | ❌ | ✅ | Chauffeur seulement |
| Sur place | ❌ | ✅ | Chauffeur seulement |
| Charger véhicule (REM) | ❌ | ✅ | Chauffeur seulement |
| Mise en parc | ❌ | ✅ | Chauffeur déclenche, peut être édité par dispatcher |
| Transformer DSP → REM | ❌ | ✅ | Chauffeur sur le terrain (constate panne grave) |
| Changer le chauffeur | ✅ | ❌ | Dispatcher seulement (ré-assignation) |
| Modifier destination | ✅ | ✅ | Les deux (chauffeur si client demande, dispatcher si erreur initiale) |
| Annuler mission | ✅ | ❌ | Dispatcher seulement (modal confirmation) |
| Créer une REL | ✅ | ❌ | Dispatcher seulement (depuis fiche mission parente en parc) |
| Terminer la mission | ❌ | ✅ | Chauffeur valide la clôture |
| Encaisser | ❌ | ✅ | Chauffeur (si paiement client) — passe par /encaissement |
| Générer le devis | ✅ | ❌ | Auto à la clôture, dispatcher peut éditer |
| Valider et envoyer la facture | ✅ | ❌ | Dispatcher seulement |

---

## 9. Spec realtime + concurrence

### 9.1 Tables avec subscription Realtime

| Table | Subscription | Usage |
|---|---|---|
| `incoming_missions` | INSERT, UPDATE, DELETE | Mise à jour live des cards et fiches |
| `mission_presence` | tous événements | Indicateur "qui consulte cette fiche" |
| `cash_transfers` | UPDATE | Validation transfert P2P (déjà en prod) |
| `users` (last_location_*) | UPDATE | Pins chauffeurs sur la carte |

### 9.2 Pattern de subscription côté browser

- Utiliser `@supabase/ssr` `createBrowserClient`
- Subscription au montage du composant
- Cleanup au démontage (`removeChannel`)
- Pas de RLS sur ces tables (déjà décidé, voir mémoire)

### 9.3 Gestion des conflits

**Dernier sauvegardé gagne**, MAIS :
- Détection via `updated_at` côté serveur
- Si le `updated_at` du serveur est plus récent que celui que le client connaissait : warning
- Modal : "Marc a modifié cette mission entre-temps. Voulez-vous écraser ou recharger ?"

---

## 10. Roadmap d'application de la spec

Cette spec ne s'applique pas en un jour. Voici l'ordre suggéré pour migrer l'app actuelle vers cette cible.

### Phase 1 — Fondations visuelles
- [ ] Audit couleurs hardcodées vs `dark:*` (script Claude Code)
- [ ] Migration light mode par défaut + toggle utilisateur
- [ ] Application palette sémantique (vert/jaune/orange/rouge/bleu/gris)
- [ ] Application couleurs marque (rouge/noir/blanc) — uniquement pour CTA et identité

### Phase 2 — Pipeline et navigation
- [ ] Création des 6 onglets du Pipeline avec compteurs live
- [ ] Card mission unifiée (composant réutilisable)
- [ ] Filtres (source, chauffeur, date)
- [ ] Toggle Pipeline ↔ Carte

### Phase 3 — Fiche mission v2
- [ ] Réorganisation des 7 infos critiques au-dessus du fold
- [ ] Sidebar droite avec 8 actions secondaires en 1er niveau
- [ ] Bandeaux d'alertes conditionnels (à encaisser, adresse non confirmée, présence autre dispatcher)
- [ ] Realtime subscription + indicateur de présence

### Phase 4 — Devis intégré
- [ ] Création auto Helpdesk + FSM + devis brouillon à la confirmation
- [ ] Affichage du devis dans la fiche (section Frais et charges)
- [ ] Mapping mission → lignes devis (table à figer avec Olivier)
- [ ] Édition inline des quantités

### Phase 5 — Imprévus first-class
- [ ] Boutons Mise en parc / DSP→REM / Changer chauffeur / Modifier destination / Annuler / Créer REL en 1er niveau
- [ ] Modals de confirmation pour actions destructives
- [ ] Workflow REL avec lien parent_mission_id

### Phase 6 — Mobile equivalence
- [ ] Toutes les fonctionnalités desktop accessibles sur mobile
- [ ] Adaptation layout (grid → stack, sidebar → bottom sticky, etc.)
- [ ] Test rush dispatcher en mode mobile (soir/weekend)

### Phase 7 — Polish
- [ ] Animations micro (transitions onglets, hover cards)
- [ ] Notifs sonores configurables
- [ ] Raccourcis clavier desktop (cmd+K recherche, j/k navigation cards)
- [ ] Mode "concentration" (full screen sans sidebar)

---

## 11. Composants réutilisables à développer

Voici la liste des composants UI atomiques à créer/refactorer pour appliquer cette spec :

### Composants atomiques (Atoms)
- `<Badge variant="success|warning|danger|info|neutral|brand">` — pour les badges sémantiques
- `<StatusPill status="nouveau|assigné|en_route|sur_place|en_parc|terminé">` — pill avec icône+label
- `<ActionButton intent="primary|secondary|destructive">` — bouton avec hiérarchie
- `<KpiCounter value={42} label="Nouveau" />` — compteur des onglets pipeline
- `<ConfirmModal title="..." onConfirm={...}>` — modal de confirmation pour actions destructives

### Composants moléculaires (Molecules)
- `<MissionCard mission={...}>` — card pipeline, avec couleur âge, actions rapides
- `<DriverPin driver={...}>` — pin chauffeur sur la carte
- `<MissionPin mission={...}>` — pin mission sur la carte
- `<TimelineStep step={...}>` — étape de la timeline chauffeur
- `<AddressInput onChange={...} googleValidation />` — input avec validation Google
- `<QuoteLineEditor line={...} onChange={...}>` — ligne éditable du devis

### Composants organiques (Organisms)
- `<PipelineTabs counts={...} active={...}>` — barre d'onglets pipeline
- `<MissionListByStatus status="nouveau">` — liste de cards filtrée
- `<MissionDetailHeader mission={...}>` — header sticky de la fiche
- `<MissionActionsSidebar mission={...} role="dispatcher|driver">` — sidebar droite
- `<QuoteSection mission={...}>` — section Frais et charges complète
- `<DriverFleetMap missions={...} drivers={...}>` — carte avec missions+chauffeurs
- `<PresenceIndicator users={...}>` — bandeau "X consulte cette fiche"

### Composants de page (Templates)
- `<DispatchPipelinePage>` — page Niveau 1
- `<DispatchMapPage>` — page Niveau 2
- `<MissionDetailPage>` — page Niveau 3 (dispatcher)
- `<DriverMissionPage>` — page Niveau 3 (chauffeur, version mobile)

---

## 12. Décisions verrouillées (constitution)

Ces décisions ne se rediscutent pas sans relecture explicite de cette spec :

1. ✅ Realtime obligatoire partout (3+ dispatchers parallèles)
2. ✅ Indicateur de présence sur les fiches consultées simultanément
3. ✅ Densité moyenne-haute avec hiérarchie visuelle forte
4. ✅ Desktop-first MAIS mobile = équivalence fonctionnelle (pas dégradé)
5. ✅ Notifs sonores + push agressives (l'app n'est pas en focus continu)
6. ✅ Vue d'ensemble lisible en 2-3 secondes au retour du dispatcher
7. ✅ Fiche mission = lecture rapide pas formulaire de saisie
8. ✅ 7 infos critiques au-dessus du fold sur la fiche
9. ✅ Assignation 1-clic sur suggestion (override par dropdown facile)
10. ✅ 8 actions imprévus en 1er niveau (pas dans menu kebab)
11. ✅ 6 onglets pipeline avec compteurs live
12. ✅ Light mode par défaut (chauffeurs au soleil) + dark optionnel
13. ✅ Couleurs marque rouge/noir/blanc séparées de la palette sémantique vert/jaune/orange/rouge alerte/bleu/gris
14. ✅ Devis Odoo intégré dans la fiche mission (pas externalisé)
15. ✅ Auto-création Helpdesk + FSM + devis à la confirmation
16. ✅ Mappage mission → lignes devis basé sur type + source + km + heures
17. ✅ Pas de RLS sur les tables Realtime (cohérent avec convention projet)
18. ✅ Last write wins avec warning UI sur conflits

---

## 13. Décisions à figer plus tard

Ces points restent ouverts, à traiter en sessions dédiées :

- [ ] Mappage exact mission → lignes devis (tableau complet par source)
- [ ] Mode "en service / off" du chauffeur (Phase 5 selon spec DSP)
- [ ] Wrap natif Capacitor + TestFlight (Phase 5)
- [ ] Tracking GPS continu (Phase 5)
- [ ] Multi-tenant : duplication repo le jour J
- [ ] Stratégie de tests E2E (Playwright ?)
- [ ] Système de raccourcis clavier desktop
- [ ] Dashboard analytics (KPIs métier : missions/jour, ETA moyen, taux conversion devis→facture)

---

## 14. Glossaire

- **DSP** : Déplacement seul (intervention sans remorquage)
- **REM** : Remorquage (avec ou sans passage par parc)
- **REM+parc** : Remorquage avec stockage temporaire sur notre terrain
- **REL** : Relivraison (mission liée à une mission parente, depuis le parc)
- **DPR** : Déplacement Pour Rien (client absent ou mission annulée sur place)
- **DPR (Odoo)** : Dossier (helpdesk ticket en Odoo)
- **FSM** : Field Service Management (module Odoo des tâches terrain)
- **Helpdesk ticket** : "Dossier chapeau" Odoo, 1 par mission
- **Plafond** : Montant max garanti par l'assistance pour la mission
- **AVP** : Accident sur Voie Publique
- **SNC** : Sortie Non Conforme (cas police spécifique)
- **Pipeline** : Vue Niveau 1 du dispatch (onglets de statut avec compteurs)
- **Fiche** : Vue Niveau 3 d'une mission (détail complet)
- **Pin** : Marqueur sur la carte Google Maps

---

## 15. Métadonnées et historique

**Création :** Mai 2026 — session de cadrage avec Olivier (Mobi) après affichage des screens app vs TowSoft.

**Cadrage source :** réponses aux 5 blocs de questions (équipe, volume, device, workflow Touring, imprévus+facturation).

**Validation :** Olivier (superadmin/dev solo).

**Mise à jour :** chaque modif majeure de cette spec doit être commitée avec un message clair (ex: `docs(ux): figer mapping mission→lignes devis pour Mondial`).

**Fin du document.**
