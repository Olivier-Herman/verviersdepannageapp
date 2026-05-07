# Audit migration thème — état + plan

**Date :** 2026-05-07
**Contexte :** Phase 1 + sub-phases 2.1 et 2.2 livrées. Test utilisateur a remonté 3 problèmes UX (incohérence thème entre écrans, champ input méconnaissable, sous-header dupliqué) tous causés par des écrans non encore migrés vers les tokens du thème.
**Périmètre :** lecture seule. Aucun fichier modifié.

---

## Résumé exécutif

- **Fichiers à migrer (UI consommateurs) :** ~30 fichiers `.tsx` significatifs (avec ≥5 occurrences hex/dark). Total UI files : 72 dans `src/app/` + 17 dans `src/components/`.
- **Occurrences à migrer :** **897 hex bracket** (`bg-[#…]`) + **1456 utilitaires Tailwind dark-only** (`zinc/gray/slate/bg-black/text-white`) = **2353 occurrences**.
- **Composants partagés clés à prioriser :**
  1. Le **`BaseShell` interne** d'`encaissement/EncaissementClient.tsx` (cause directe du Problème 3 — sous-header mobile dupliqué)
  2. Les **inputs HTML répétés inline** dans encaissement, mission/police, mission/new (cause du Problème 2 — input qui ressemble à un bouton)
  3. **`AddressField.tsx`** (composant partagé entre dispatch new + dispatch[id])
  4. **`DriverPickerModal.tsx`** (modal partagée dispatch list + fiche)
  5. Pattern `inputCls` factorisé (cf. `/admin/depots`, `/admin/users`) à propager
- **Effort total estimé :** **~22-26 heures Claude Code** pour migration complète (3 fichiers >1000 lignes pèsent ⅔ du chantier).
- **Délai estimé avant cohérence visuelle complète :** **5-7 sessions** (le module mission/dispatch représente la moitié du temps).
- **Stratégie recommandée :** quickfix /encaissement immédiat (1h, résout les 3 problèmes signalés) → puis migration par module dans l'ordre du flux chauffeur (mission → dispatch → admin reliquats) → refactor composants partagés en parallèle quand l'opportunité se présente.
- **Premier prompt à exécuter :** **« quickfix encaissement »** — corrige les 3 problèmes en une session focalisée, débloque le chauffeur en production.

---

## Section 1 — Inventaire hex hardcodés (top 30 fichiers)

Pondéré par la **somme** des `bg-[#…]/text-[#…]/border-[#…]` (bracket hex) **et** des classes Tailwind dark-only (`zinc/gray/slate/bg-black/text-white`). Le score reflète l'ampleur réelle du chantier visuel sur chaque fichier.

| # | Fichier | Bracket hex | Dark utils | Total |
|---|---|---:|---:|---:|
| 1 | `src/app/mission/[id]/DriverClient.tsx` | 84 | 203 | **287** |
| 2 | `src/app/dispatch/[id]/MissionDetailClient.tsx` | 61 | 166 | **227** |
| 3 | `src/app/dispatch/new/NewMissionClient.tsx` | 49 | 108 | **157** |
| 4 | `src/app/dispatch/DispatchClient.tsx` | 29 | 87 | **116** |
| 5 | `src/app/services/tgr/TGRClient.tsx` | 22 | 79 | **101** |
| 6 | `src/app/encaissement/EncaissementClient.tsx` | 27 | 63 | **90** |
| 7 | `src/app/avance-fonds/AvanceFondsClient.tsx` | 18 | 60 | **78** |
| 8 | `src/app/profil/ProfileClient.tsx` | 23 | 58 | **81** |
| 9 | `src/app/mission/police/PoliceClient.tsx` | 0 | 58 | **58** |
| 10 | `src/app/mission/new/NewDriverMissionClient.tsx` | 23 | 58 | **81** |
| 11 | `src/app/documents/DocumentsClient.tsx` | 25 | 55 | **80** |
| 12 | `src/app/caisse/CashClient.tsx` | 16 | 55 | **71** |
| 13 | `src/app/admin/tgr/AdminTGRClient.tsx` | 16 | 53 | **69** |
| 14 | `src/app/encaissements/EncaissementsClient.tsx` | 15 | 42 | **57** |
| 15 | `src/app/admin/check-vehicule/settings/CheckVehiculeSettingsClient.tsx` | 15 | 36 | **51** |
| 16 | `src/app/admin/missions/page.tsx` | 14 | 35 | **49** |
| 17 | `src/app/admin/settings/SettingsClient.tsx` | 14 | 29 | **43** |
| 18 | `src/app/encaissement/EncaissementsClient.tsx` *(autre fichier)* | 11 | 28 | **39** |
| 19 | `src/app/check-vehicule/[id]/CheckDetailClient.tsx` | 0 | 28 | **28** |
| 20 | `src/app/admin/documents/AdminDocumentsClient.tsx` | 9 | 24 | **33** |
| 21 | `src/app/admin/vr-locations/VrLocationsClient.tsx` | 9 | 23 | **32** |
| 22 | `src/app/request-access/page.tsx` | 9 | 21 | **30** |
| 23 | `src/app/mission/MissionListClient.tsx` | 3 | 19 | **22** |
| 24 | `src/app/mission/page.tsx` | 2 | 18 | **20** |
| 25 | `src/app/login/page.tsx` | 8 | 18 | **26** |
| 26 | `src/app/admin/check-vehicule/AdminCheckVehiculeClient.tsx` | 4 | 18 | **22** |
| 27 | `src/components/DriverPickerModal.tsx` | 2 | 17 | **19** |
| 28 | `src/app/admin/cash/AdminCashClient.tsx` | 5 | 16 | **21** |
| 29 | `src/app/garde/GardeClient.tsx` | 3 | 13 | **16** |
| 30 | `src/components/dispatch/DispatchMap.tsx` | 3 | 12 | **15** |

**Note :** les 4 premiers fichiers (mission/dispatch + 2 wizards) totalisent **787 occurrences** = ⅓ du chantier global.

---

## Section 2 — Composants partagés (haute valeur de migration)

L'app a peu de composants vraiment partagés (la plupart des patterns sont **inlinés** dans chaque écran — c'est la dette principale).

### Composants exportés réutilisés

| Composant | Usages | Hex/dark interne | Valeur |
|---|---|---:|---|
| `src/components/AddressField.tsx` | 2 (dispatch/new + dispatch/[id]) | ~12 | **MED** |
| `src/components/DriverPickerModal.tsx` | 2 (dispatch/list + fiche) | 19 | **MED** |
| `src/components/missions/DriverTimeline.tsx` | 1 (dispatch/[id]) | 10 | LOW |
| `src/components/dispatch/DispatchMap.tsx` | 1 (dispatch/list) | 15 | LOW |
| `src/components/check-vehicule/VehicleCheckBanner.tsx` | utilisé via AppShell | <5 | LOW |
| `src/components/DutyIndicator.tsx` | 0 (orphelin depuis 2.2) | <5 | NIL — purger |

### Sous-composants locaux à factoriser (haute valeur)

Ce sont des composants définis **inline dans un seul fichier** mais qui répliquent un même pattern pénalisant la migration. Si on les promeut en composant partagé migré, on gagne sur tous les écrans concernés.

| Pattern (à factoriser en `<WizardShell>`, `<WizardInput>`, etc.) | Fichiers concernés | Valeur |
|---|---|---|
| **`BaseShell` wizard** (header mobile + progress bar dupliqués) | `encaissement/EncaissementClient` + pattern similaire dans `mission/police`, `mission/new`, `avance-fonds` | **HIGH** |
| **`BigBtn` / `ChoiceBtn`** (boutons wizard arrondis 2xl) | `encaissement/EncaissementClient` (lignes 79-97), patterns équivalents dans `avance-fonds`, `mission/police` | **HIGH** |
| **Input hex hardcodé `bg-[#1e1e1e] border-[#333]`** (5+ fois dans encaissement, idem ailleurs) | `encaissement/EncaissementClient`, `dispatch/new/NewMissionClient`, `dispatch/[id]/MissionDetailClient`, `mission/police/PoliceClient`, `mission/new/NewDriverMissionClient` | **HIGH** — cause directe Problème 2 |
| Composant `Toggle` switch (créé local dans `/admin/users`) | déjà inline dans `users` ; à utiliser aussi dans `admin/settings`, `mission/[id]` | MED |
| Modal d'édition pattern (backdrop + panel) | `users`, `depots` (déjà migrés) ; à factoriser pour les futures | MED |

**Recommandation :** créer en Phase 2/3 un fichier `src/components/ui/Input/Input.tsx` (composant partagé) **avant** de migrer encaissement/mission. Ça évite de répéter `inputCls` const dans 6+ écrans.

---

## Section 3 — Écrans qui n'utilisent PAS l'AppShell

Total : **14 écrans utilisent AppShell** sur 72. Le reste se répartit en :

### Écrans publics auth (sans shell — normal, pas de menu nav)
| Écran | Hex/dark | Solution |
|---|---:|---|
| `/login` | 26 | Migration tokens — pas d'AppShell (pas de menu pour user déconnecté) |
| `/forgot-password` | 8 | idem |
| `/reset-password` | 9 | idem |
| `/change-password` | 11 | idem |
| `/request-access` | 30 | idem |
| `/request-access/pending` | 5 | idem |

### Module admin (utilise AdminLayoutClient — déjà migré)
| Écran | Hex/dark | Solution |
|---|---:|---|
| `/admin/cash` | 21 | Migration tokens (le shell admin est OK) |
| `/admin/check-vehicule` + sous-pages | 51 | idem |
| `/admin/documents` | 33 | idem |
| `/admin/missions` | 49 | idem |
| `/admin/settings` | 43 | idem |
| `/admin/tgr` | 69 | idem |
| `/admin/vr-locations` | 32 | idem |
| `/admin/depots` | déjà migré | ✅ |
| `/admin/users` | déjà migré | ✅ |

### Module dispatch — Sidebar custom inline (vraiment dupliquée)
| Écran | Hex/dark | Problème |
|---|---:|---|
| `/dispatch` | 116 | `function Sidebar` interne avec hex hardcodés (3× `<Sidebar>` dans le fichier) |
| `/dispatch/[id]` | 227 | idem |
| `/dispatch/new` | 157 | idem |

**Solution :** ces 3 écrans devront être migrés vers `AppShell` ou avoir leur sidebar custom migrée. Vu leur volume (951 + 1903 + 955 = 3809 lignes), c'est la sub-phase 2.3 dédiée.

### Module chauffeur (mission)
| Écran | Hex/dark | Solution |
|---|---:|---|
| `/mission/[id]` (DriverClient.tsx, 1446 lignes) | **287** | Pas d'AppShell, écran fullscreen mobile-first. À refondre Phase 3 (fiche v2). |
| `/mission/new` | 81 | À migrer (ajouter AppShell + tokens) |
| `/mission/police` | 58 | À migrer |
| `/mission` (liste) | 22 | Utilise AppShell ; juste tokens à migrer |

### Encaissement (cas particulier signalé Problème 3)
| Écran | Hex/dark | Problème |
|---|---:|---|
| `/encaissement` | 90 | **Utilise AppShell mais ajoute un sous-header mobile dupliqué dans `BaseShell` interne** |
| `/encaissement/payment-callback` | 11 | Petit écran de retour SumUp, à migrer |
| `/encaissements` (admin) | 57 | Utilise AppShell — juste tokens à migrer |

### Services
| Écran | Hex/dark | Solution |
|---|---:|---|
| `/services/tgr` | 101 | Utilise AppShell — tokens à migrer |
| `/services/tgr/take` | 17 | Page externe partner, à migrer |

### Spécifique check-vehicule
| Écran | Hex/dark | Solution |
|---|---:|---|
| `/check-vehicule` | <10 | Utilise AppShell, presque OK |
| `/check-vehicule/[id]` | 28 | Tokens à migrer |

---

## Section 4 — Focus encaissement (priorité 1)

### a) Fichiers du module

```
src/app/encaissement/
  ├── page.tsx                          (45 lignes, server, OK pas de hex)
  ├── EncaissementClient.tsx            (1021 lignes — wizard 9 étapes)
  ├── EncaissementsClient.tsx           (182 lignes — liste/historique)
  └── payment-callback/
       └── page.tsx                     (81 lignes — retour SumUp)

src/app/encaissements/                  (admin — pluriel, /mouvements)
  ├── page.tsx                          (18 lignes, OK)
  └── EncaissementsClient.tsx           (344 lignes)
```

Aucun fichier dans `src/components/encaissement/` — tous les sous-composants sont inline.

### b) Composant Step / Wrapper (= `BaseShell`)

`src/app/encaissement/EncaissementClient.tsx` **lignes 28-77**.

`BaseShell` est un wrapper interne qui :
1. Utilise déjà `<AppShell title=… userRole userName userModules headerExtra={progressBar}>` ✓
2. **MAIS** ajoute par-dessus, dans `children`, un **second header mobile** (lignes 53-63) :
   ```tsx
   <div className="lg:hidden bg-[#1A1A1A] border-b border-[#2a2a2a] px-5 pt-3 pb-4">
     <div className="flex items-center gap-3 mb-3">
       <button onClick={onBack} className="w-10 h-10 ... bg-[#2a2a2a] rounded-xl text-white text-lg active:bg-[#333]">←</button>
       <span className="flex-1 text-zinc-500 text-xs">{title}</span>
       <div className="w-10" />
     </div>
     {progressBar}
   </div>
   ```
   → **C'est le Problème 3** : ce header local cohabite avec celui du AppShell mobile (qui a déjà burger + logo + back + title + progressBar via `headerExtra`).

3. Ajoute aussi un bouton retour desktop (lignes 66-72) — utile pour le retour wizard, à conserver mais déplaçable.

**Fix Problème 3 :** supprimer le bloc `<div className="lg:hidden bg-[#1A1A1A] …">` lignes 52-63 et déplacer le bouton wizard `← Retour` dans `headerExtra` aux côtés de la progress bar (ou en haut du content area).

### c) Inputs (« champ qui ressemble à un bouton »)

5 inputs dans `EncaissementClient.tsx` avec exactement le même pattern dark hardcodé :

| Ligne | Champ | Classes problématiques |
|---|---|---|
| 437 | Plaque (étape 0) | `bg-[#1e1e1e] border border-[#333] text-white text-2xl … tracking-widest uppercase` |
| 509 | Marque (étape 2) | `bg-[#1e1e1e] border border-[#333] text-white text-xl …` |
| 544 | Modèle (étape 2) | `bg-[#1e1e1e] border border-[#333] text-white text-lg …` |
| 562 | Précision motif (étape 13) | `bg-[#1e1e1e] border border-[#333] text-white text-base …` |
| 649 | Montant € (étape 5) | `bg-[#1e1e1e] border border-[#333] text-white text-3xl font-bold …` |
| 771, 863, 934, 944, 954 | Champs client (TVA, nom, adresse, ville, CP) | même pattern |

Total : **10 inputs avec le même pattern hex**. Sur fond beige clair en light mode, le `bg-[#1e1e1e]` (gris très foncé) crée un **bloc noir massif** qui ressemble à un bouton.

**Fix Problème 2 :** factoriser une const `inputCls` (pattern déjà appliqué dans `/admin/depots` et `/admin/users`) :

```ts
const inputCls =
  'w-full bg-surface border rounded-md px-3 py-2.5 text-sm text-ink ' +
  'focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft ' +
  'placeholder:text-ink-muted transition-colors'
```

Avec quelques variantes de taille pour les inputs « XL » (plaque, montant) :
```ts
const inputXLCls = inputCls + ' text-2xl font-bold text-center tracking-widest uppercase py-4'
```

### d) Sous-header (= partie du `BaseShell`)

Voir (b) — c'est le bloc des lignes 52-63. Il sera supprimé dans le fix.

### e) Layout

`/encaissement` **utilise déjà AppShell** (cf. ligne 51 `<AppShell title=...>`). Le problème est uniquement le sous-header dupliqué et les inputs dark.

**Pas besoin de réécrire le layout** — juste corriger le `BaseShell`.

### f) Estimation effort migration COMPLÈTE de /encaissement

- `BaseShell` refactor (suppression sous-header, déplacement back button, tokens) : **30 min**
- Factorisation `inputCls` + remplacement des 10 inputs : **30 min**
- Migration des 90 occurrences hex/dark restantes (`BigBtn`, `ChoiceBtn`, contenu des 9 étapes) : **1h30 - 2h**
- Migration `/encaissement/EncaissementsClient.tsx` (liste) : **45 min** (39 occ)
- Migration `/encaissement/payment-callback/page.tsx` : **15 min** (11 occ)

**Total /encaissement : ~3h-3h30 Claude Code.**

**Fix rapide pour résoudre les 3 problèmes signalés (sans migrer les 9 étapes complètement) : ~1h** — c'est ce que je recommande en première frappe.

---

## Section 5 — Estimation effort par module

| Module | Fichiers | Hex+dark | Composants partagés à propager | Effort |
|---|---:|---:|---|---|
| **Auth (login + reset/change/forgot/request-access)** | 6 | ~110 | aucun (pages standalone) | **MED** (1h30) |
| **Encaissement** (singulier + pluriel + callback) | 4 sig. | ~200 | factoriser `inputCls`, supprimer `BaseShell` doublon | **HIGH** (3h-3h30) |
| **Mission chauffeur** (`/mission/[id]` + new + police + liste + page) | 5 sig. | **~470** | factoriser inputs + buttons wizard, intégrer AppShell sur `/mission/police`, `/mission/new` | **CRITICAL** (6h-7h) |
| **Dispatch** (list + fiche + new) | 3 sig. | **~500** | migrer `Sidebar` custom interne → AppShell, factoriser `MissionCard` (à utiliser via `<Panel>`/`<Badge>`), migrer modals inline | **CRITICAL** (5h-6h) |
| **Profil + documents + caisse + avance-fonds + garde + tgr** | 6 sig. | ~410 | factoriser `inputCls`, modals inline | **HIGH** (3h-4h) |
| **Admin reliquat** (cash/check-vehicule/documents/missions/settings/tgr/vr-locations) | 7 sig. | ~280 | factoriser `inputCls`, modals inline | **HIGH** (3h-4h) |
| **Check véhicule** (front user) | 2 sig. | ~38 | tokens uniquement | LOW (45 min) |
| **Composants partagés** (`AddressField`, `DriverPickerModal`, `DriverTimeline`, `DispatchMap`) | 4 | ~50 | en faire des composants thème-natifs (gain DRY) | MED (1h30) |

**Total estimé : 22-26 heures Claude Code.**

---

## Section 6 — Plan de migration recommandé

Stratégie : **résoudre les douleurs production immédiates → propager les patterns → finir les modules par taille croissante**.

### ÉTAPE A — Quickfix /encaissement (estimation : 1h)

Cible directe des 3 problèmes signalés ce matin. Délivrable autonome, mergeable seul.

- **Fix Problème 3** : suppression du sous-header mobile dupliqué dans `BaseShell` (lignes 52-63 de `EncaissementClient.tsx`). Le bouton "Retour" wizard déplacé dans `headerExtra` aux côtés de la progress bar (ou en haut du content desktop, déjà présent).
- **Fix Problème 2** : factoriser `inputCls` (pattern depots/users), remplacer les 10 inputs dark hardcodés.
- **Fix bonus Problème 1 partiel** : migrer les hex bracket de `BaseShell`, `BigBtn`, `ChoiceBtn` → tokens. Le wizard devient cohérent light/dark.

⚠ Ne migre **PAS** tout le contenu des 9 étapes (les écrans intérieurs gardent leurs hex pour l'instant — sera fait à l'étape D).

**Impact :** les 3 retours utilisateur d'aujourd'hui sont résolus. Olivier peut tester en prod sans plainte chauffeur.

### ÉTAPE B — Composants partagés réutilisables (estimation : 2h-2h30)

Avant d'attaquer les gros écrans, créer/migrer les composants vraiment partagés. C'est ⅓ de l'effort qui rend ⅔ de la migration plus rapide.

- **Créer `src/components/ui/Input/Input.tsx`** — composant atomique avec variants (`default`, `xl-center` pour plaques/montants), tokens thème, slots leading/trailing icon. Le pattern `inputCls` const cesse d'être dupliqué dans 6+ fichiers.
- **Migrer `src/components/AddressField.tsx`** vers tokens (12 occ).
- **Migrer `src/components/DriverPickerModal.tsx`** vers `<ConfirmModal>` ou pattern modal thème (19 occ).
- **Purger `src/components/DutyIndicator.tsx`** (orphelin depuis sub-phase 2.2 qui a inliné le toggle).

**Impact :** le module mission/dispatch deviendra plus rapide à migrer (étapes D et E).

### ÉTAPE C — Modules secondaires (estimation : 4h-5h)

Migration des écrans qui utilisent déjà AppShell et n'ont que des tokens à remplacer. Ordre : par utilisation chauffeur → admin.

1. **Auth (login, reset/change/forgot/request-access)** : 1h30
2. **Profil + caisse + avance-fonds + garde + documents + services/tgr** : 2h-2h30
3. **Admin reliquat (cash, settings, tgr, vr-locations, missions, check-vehicule, documents)** : prochaine session, ~3h-4h en sub-phase 2.6

**Impact :** ~50% des écrans deviennent thématiques. L'incohérence Problème 1 est largement résolue dès la fin de C.

### ÉTAPE D — Module mission chauffeur (estimation : 6h-7h)

Le plus gros morceau hors dispatch. Sub-phase 3.x dédiée.

- `/mission/[id]/DriverClient.tsx` (1446 lignes, 287 occ) — refonte complète
- `/mission/new`, `/mission/police` — ajout AppShell + tokens
- `/mission` (liste) — tokens uniquement
- Réutilisation des composants partagés étape B

**Impact :** parcours chauffeur entièrement migré. Aligne avec la roadmap spec UX (Phase 5 imprévus + actions chauffeur).

### ÉTAPE E — Module dispatch (estimation : 5h-6h)

- `/dispatch` (list, 951 lignes) — Sidebar custom interne → AppShell global, modals inline → `<ConfirmModal>` quand applicable, table → `<Panel noPadding>` + cellules tokens
- `/dispatch/[id]` (1903 lignes) — c'est le plus gros, à découper en 2-3 sessions
- `/dispatch/new` (955 lignes) — ajout AppShell, tokens

**Impact :** **Phase 2.3 originale** complétée. Le pipeline et la fiche mission sont thématiques. C'est aussi à ce moment qu'on intégrera les `<KpiCard>`, `<MissionCard>` (à créer), `<StatusPill>` selon spec UX.

### Ordre suggéré (rappel)

| Ordre | Étape | Délai | Bénéfice utilisateur |
|---|---|---|---|
| 1 | A — Quickfix /encaissement | 1h | Résout les 3 plaintes du jour |
| 2 | B — Composants partagés | 2h-2h30 | DRY pour la suite |
| 3 | C — Modules secondaires | 4h-5h | 50% de l'app cohérente |
| 4 | D — Mission chauffeur | 6h-7h | Parcours chauffeur complet |
| 5 | E — Dispatch | 5h-6h | Pipeline + fiche thématiques |

**Délai total avant cohérence visuelle complète :** **5-7 sessions** Claude Code (1-2h chacune en moyenne).

**Étape 2.3 originale (Pipeline)** : reste prévue mais déplacée APRÈS l'étape A. Phase 2 sera donc Phase 2.bis : 2.3.A (quickfix encaissement), 2.3.B (composants partagés), 2.3.C (modules secondaires), puis le vrai 2.3 historique = étape E (dispatch refonte avec KpiCard etc.).

---

## Annexe — Données brutes utilisées

**Total fichiers `.tsx` :** 89 (72 dans `src/app/`, 17 dans `src/components/`).

**Occurrences globales (grep tout `src/`) :**
- Bracket hex (`bg-\[#`, `text-\[#`, `border-\[#`) : **897**
- Dark utilities (`zinc/gray/slate-*`, `bg-black`, `text-white`) : **1456**
- **Total à migrer : 2353**

**Composants déjà migrés en Phase 1 + 2.1 + 2.2 :**
- `tailwind.config.ts`, `globals.css`, `layout.tsx` — fondations
- `src/components/theme/ThemeProvider.tsx`
- `src/components/ui/*` (7 atomes : Button, Badge, Avatar, Panel, KpiCard, StatusPill, ConfirmModal)
- `src/components/layout/AppShell.tsx`, `MobileNavDrawer.tsx`
- `src/app/admin/AdminLayoutClient.tsx`, `AdminNav.tsx`, `layout.tsx`
- `src/app/admin/depots/DepotsAdminClient.tsx`
- `src/app/admin/users/UsersClient.tsx`
- `src/app/dashboard/DashboardClient.tsx`

**Fichiers non migrés signalés Phase 1 audit (pour comparaison) : 45.** Ce nouvel audit en identifie ~30 significatifs (hex+dark > 15 occurrences chacun) ; les fichiers <15 occurrences sont rapides à migrer en lot.

---

**Fin du rapport.**
