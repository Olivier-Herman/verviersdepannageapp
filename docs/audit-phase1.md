# Audit Phase 1 — Fondations visuelles

**Date :** 2026-05-06
**Scope :** `src/**` (.tsx, .ts, .css)
**Objectif :** identifier l'écart entre l'existant et la cible visuelle (mockup v3 + spec UX section 3).

Ce rapport sert de base aux étapes 2-5 de la phase 1. Pas de code modifié à ce stade — uniquement constats.

---

## 1. Configuration actuelle vs cible

### 1.1 `tailwind.config.ts` — état actuel

```ts
colors: {
  brand: '#CC2222',        // ⚠️ pas la cible (#E11D2E)
  'brand-dark': '#991818', // ⚠️ pas la cible (#C8102E)
  'brand-light': 'rgba(204,34,34,0.1)',
  surface: '#1A1A1A',      // ⚠️ couleur dark mode hardcodée comme défaut
  'surface-2': '#222222',  // ⚠️ idem
  border: '#2a2a2a',       // ⚠️ idem
}
```

**Manquants vs cible :**
- Aucune couleur sémantique (success / warning / alert / critical / info / neutral)
- Pas de variants -soft / -fill / -hover
- Pas de neutres chauds (bg-page-gradient, bg-surface-2, text-primary, etc.)
- Pas de fontFamily custom (display / body / mono)
- Pas de borderRadius custom
- Pas de boxShadow custom (`shadow-card` notamment)

### 1.2 `src/app/globals.css` — état actuel

- `body { background: #0F0F0F; color: #ffffff }` → **dark mode forcé en dur**, contradictoire avec décision verrouillée n°12 (light par défaut)
- Police chargée : `'Inter', sans-serif` (en CSS, sans `next/font`)
- Aucune variable CSS pour le thème (pas de `--bg-surface`, `--text-primary`, etc.)
- Pas de classe `.theme-light` / `.theme-dark`

### 1.3 `src/app/layout.tsx` — état actuel

- `next/font/google` charge **Inter uniquement** (`const inter = Inter({ subsets: ['latin'] })`)
- `themeColor: '#CC2222'` (à mettre à jour vers `#E11D2E`)
- Pas de `Plus Jakarta Sans` ni `JetBrains Mono`

### 1.4 Dépendances utiles déjà présentes

| Package | Version | Rôle |
|---|---|---|
| `next` | 14.2.5 | App Router |
| `react` | 18.3.1 | — |
| `tailwindcss` | 3.4.6 | — |
| `lucide-react` | 0.408.0 | Icônes (à utiliser dans composants UI) |
| `next/font` | (built-in) | Pour preload des 3 polices |

**Aucune nouvelle dépendance à installer pour la phase 1** — tout est faisable avec l'existant.

---

## 2. Couleurs hardcodées — top occurrences

### 2.1 Hex hardcodés (.tsx + .css, hors API/email/PDF)

| Hex | Occurrences | Rôle actuel | Action cible |
|---|---|---|---|
| `#2a2a2a` | **459** | Bordures dark mode | → `border` (token) |
| `#1A1A1A` / `#1a1a1a` | **203** | Surface dark | → `bg-surface` (token, dark only) |
| `#0F0F0F` | **106** | Fond page dark | → `bg-page` (token, dark only) |
| `#111` | **104** | Inputs dark | → `bg-input` (token) |
| `#333` | **88** | Bordures ou textes | → `border-strong` ou `text-muted` |
| `#888` | **41** | Texte secondaire | → `text-muted` |
| `#1e1e1e` | **37** | Surface alt dark | → `bg-surface-2` |
| `#222` | **30** | Surface alt dark | → `bg-surface-2` |
| `#666` | **25** | Texte | → `text-secondary` |
| `#CC2222` / `#cc2222` | **30** | Marque rouge legacy | → `brand.red` (`#E11D2E`) |
| `#CC0000` / `#cc0000` | **30** | Marque rouge alt | → `brand.red` |

**Total hex distincts trouvés :** ~85.
**Files concernés (top hex dark) :** 45 fichiers (cf. liste section 5).

### 2.2 Hex liés à la marque red (à migrer)

Fichiers à réviser pour `#CC2222 / #cc2222 / #CC0000 / #cc0000` :
- `src/app/layout.tsx` (themeColor)
- `src/app/globals.css` (`--brand`, `--brand-dark`)
- `src/app/mission/[id]/DriverClient.tsx`
- `src/lib/receipt.ts`, `src/lib/emails.ts`, `src/lib/sumup.ts` (PDF/HTML email — **hors scope** UI)
- `src/app/api/**/route.ts` (HTML emails / PDFs — **hors scope** UI, ne pas toucher)

**Décision suggérée :** ne migrer que les fichiers UI (`.tsx` rendus en client). Les emails/PDFs restent en hex hardcodés tant qu'on ne les refond pas.

### 2.3 Classes Tailwind couleur — usage actuel

**Couleurs marque (utilisation propre via `brand` token Tailwind) :**

| Classe | Occurrences |
|---|---|
| `bg-brand` | **128** |
| `bg-brand-dark` | **13** |

C'est **propre** : le token `brand` est bien utilisé. Il faudra juste mettre à jour la valeur du token (`#CC2222 → #E11D2E`) et tous les écrans suivront.

**Couleurs Tailwind directes (rouge) — usage problématique :**

| Classe | Occurrences | Problème |
|---|---|---|
| `bg-red-500` | **47** (dans 25 fichiers) | Mix marque/alerte — à séparer |
| `bg-red-600` | 11 | Idem |
| `bg-red-900` | 9 | Dark variant ad-hoc |
| `bg-red-950` | 8 | idem |

➡ **47 occurrences de `bg-red-500`** : besoin de catégoriser chaque usage en (a) marque, (b) urgence/critique, (c) destructif (delete, cancel). C'est la **dette de couleur** principale.

**Couleurs Tailwind sémantiques — usage actuel :**

| Famille | Total occurrences (top) |
|---|---|
| `text-zinc-*` | ~810 (text-zinc-500 = 330, -400 = 257, -600 = 132, -300 = 59) |
| `text-red-*` | ~120 (red-400 = 94, red-300 = 12, red-500 = 8) |
| `text-green-*` | ~110 (green-400 = 80, green-300 = 11, autres) |
| `text-blue-*` | ~50 (blue-400 = 32) |
| `text-amber-*` / `text-yellow-*` | ~45 |
| `text-orange-*` | ~30 |

L'app utilise déjà un vocabulaire **sémantique implicite** (vert = succès, jaune/amber = warning, orange = alerte, red = critique/danger). C'est cohérent avec la spec. Le travail = **codifier ces choix** dans Tailwind via tokens et migrer les classes au cas par cas.

---

## 3. Polices

### 3.1 État actuel
- `Inter` chargé via `next/font/google` dans `src/app/layout.tsx` ✓
- Appliqué via `<body className={inter.className}>` ✓
- Aucune autre police custom chargée
- `'Inter', sans-serif` aussi présent en dur dans `globals.css` (redondant avec next/font)

### 3.2 Cible spec v3
- **Display** : `Plus Jakarta Sans` (400/500/600/700/800) — pour titres et chiffres KPI
- **Body** : `Inter` (400/500/600/700) — pour texte courant
- **Mono** : `JetBrains Mono` (500/600) — pour plaques, dossiers, montants

➡ **2 polices à ajouter** via `next/font/google` (preload activé).

### 3.3 Usage de `font-mono` actuel
- 0 occurrence dans `.tsx` (vérifié via grep `font-mono`)
- Les plaques sont actuellement en `font-bold font-mono text-xs` mais avec la police mono système (pas JetBrains)
- Le `tracking-wide` est utilisé pour les codes — pas indispensable

---

## 4. Composants UI existants

### 4.1 Dossier `src/components/ui/`

**État :** **vide** (juste créé, aucun fichier). Bonne nouvelle pour la phase 1 — pas de refactor de composant atomique existant à faire.

### 4.2 Composants dispersés à recenser

Tous les "patterns Button/Badge/Card" sont actuellement écrits **inline dans chaque écran** (pas de composant partagé). Pas de `<Button>`, `<Badge>`, `<Card>` réutilisable.

**Exemples de patterns inline récurrents :**

| Pattern | Forme actuelle | Composant cible |
|---|---|---|
| Bouton primaire rouge | `className="px-4 py-2 bg-brand hover:bg-brand-dark text-white rounded-xl text-sm font-medium transition"` | `<Button variant="primary">` |
| Bouton secondaire | `className="px-4 py-2 bg-[#1A1A1A] border border-[#2a2a2a] hover:bg-[#222] text-white rounded-xl text-sm"` | `<Button variant="secondary">` |
| Bouton danger | `className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs"` | `<Button variant="danger">` |
| Badge sémantique | `className="px-2 py-0.5 rounded text-xs font-bold text-white bg-blue-600"` | `<Badge variant="info">` |
| Avatar circle | `className="w-8 h-8 rounded-full bg-brand flex items-center justify-center text-white font-bold"` | `<Avatar>` |
| Card panel | `className="bg-[#1A1A1A] border border-[#2a2a2a] rounded-2xl p-4"` | `<Panel>` |
| Modal backdrop | `className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"` | `<ConfirmModal>` |
| Spinner | `className="animate-spin h-4 w-4 ..."` (19 occurrences) | Slot `loading` du `<Button>` |

**Estimation :** ces patterns sont répliqués des **dizaines de fois** chacun (`bg-brand` à 128 occurrences, `rounded-xl` à 425, `rounded-2xl` à 208).

### 4.3 Composants existants ailleurs (non atomiques)

| Fichier | Rôle | Phase 1 ? |
|---|---|---|
| `src/components/AddressField.tsx` | Input adresse Google Places | ❌ Phase 4 (devis) ou 2 (refonte fiche) |
| `src/components/DriverPickerModal.tsx` | Modal choix chauffeur (createPortal) | ❌ Phase 5 (imprévus) |
| `src/components/DutyIndicator.tsx` | Badge garde jour/nuit | ❌ Phase 5 |
| `src/components/dispatch/DispatchMap.tsx` | Composant carte Google | ❌ Phase 2 (carte) |
| `src/components/missions/DriverTimeline.tsx` | Timeline chauffeur | ❌ Phase 3 (fiche) |
| `src/components/check-vehicule/VehicleCheckBanner.tsx` | Bandeau alerte | À garder, peut adopter `<Panel>` |
| `src/components/layout/AppShell.tsx` | Shell global pages | À garder, à reskinner phase 1 (CSS vars) |
| `src/components/layout/MobileNavDrawer.tsx` | Drawer mobile | À garder, à reskinner phase 1 |
| `src/components/layout/Providers.tsx` | next-auth + autres | Ajouter ThemeProvider ici |
| `src/components/layout/nav-items.ts` | Source canonique navigation | Inchangé |

### 4.4 Modals — pattern actuel

- `createPortal` utilisé dans `DriverPickerModal.tsx` (3 occurrences)
- Sinon : **modal inline avec `fixed inset-0`** dans `DispatchClient.tsx`, `MissionDetailClient.tsx`, `ProfileClient.tsx`, `EncaissementsClient.tsx`, `AdminTGRClient.tsx`, `UsersClient.tsx`, `DepotsAdminClient.tsx`, `AdminDocumentsClient.tsx`, `DocumentsClient.tsx`, `TGRClient.tsx`, `PoliceClient.tsx`, `DriverClient.tsx` (12+ fichiers)
- Pas de gestion uniforme du Escape, du body-scroll-lock, du backdrop blur
- ➡ Le `<ConfirmModal>` à créer servira de référence ; les autres modals migreront en phase 2-5

---

## 5. Cartographie écrans → patterns à toucher

### 5.1 Fichiers UI utilisant les hex dark hardcodés (45)

```
src/app/admin/AdminLayoutClient.tsx
src/app/admin/AdminNav.tsx
src/app/admin/cash/AdminCashClient.tsx
src/app/admin/check-vehicule/AdminCheckVehiculeClient.tsx
src/app/admin/check-vehicule/settings/CheckVehiculeSettingsClient.tsx
src/app/admin/depots/DepotsAdminClient.tsx
src/app/admin/documents/AdminDocumentsClient.tsx
src/app/admin/missions/page.tsx
src/app/admin/settings/SettingsClient.tsx
src/app/admin/tgr/AdminTGRClient.tsx
src/app/admin/users/UsersClient.tsx
src/app/admin/vr-locations/VrLocationsClient.tsx
src/app/avance-fonds/AvanceFondsClient.tsx
src/app/caisse/CashClient.tsx
src/app/change-password/page.tsx
src/app/dashboard/DashboardClient.tsx
src/app/dispatch/DispatchClient.tsx           ← Phase 2/3 (NE PAS TOUCHER MAINTENANT)
src/app/dispatch/[id]/MissionDetailClient.tsx ← Phase 3 (NE PAS TOUCHER)
src/app/dispatch/new/NewMissionClient.tsx     ← Phase 2/3 (NE PAS TOUCHER)
src/app/documents/DocumentsClient.tsx
src/app/encaissement/EncaissementClient.tsx
src/app/encaissement/EncaissementsClient.tsx
src/app/encaissement/payment-callback/page.tsx
src/app/encaissements/EncaissementsClient.tsx
src/app/finance/FinanceClient.tsx
src/app/forgot-password/page.tsx
src/app/garde/GardeClient.tsx
src/app/globals.css
src/app/login/page.tsx
src/app/mission/MissionListClient.tsx         ← Phase 3 (NE PAS TOUCHER)
src/app/mission/[id]/DriverClient.tsx         ← Phase 3 (NE PAS TOUCHER)
src/app/mission/new/NewDriverMissionClient.tsx← NE PAS TOUCHER (police/towsoft)
src/app/mission/page.tsx                      ← Phase 3 (NE PAS TOUCHER)
src/app/profil/ProfileClient.tsx
src/app/request-access/page.tsx
src/app/request-access/pending/page.tsx
src/app/reset-password/page.tsx
src/app/services/tgr/TGRClient.tsx
src/app/services/tgr/take/page.tsx
src/components/AddressField.tsx
... + AppShell, MobileNavDrawer, etc.
```

### 5.2 Candidats pour le proof-of-concept (étape 5)

Le prompt suggère un écran simple parmi `/admin` ou `/caisse`. Mes 2 candidats classés du plus simple au plus complexe :

| Candidat | Complexité | Raison |
|---|---|---|
| **`/admin/depots`** | Faible | Liste simple, formulaire CRUD basique, peu de logique métier, parfait pour valider les composants `<Panel>` `<Button>` `<Badge>`. |
| **`/admin/users`** | Moyenne | Liste avec modal édition + permissions matrix. Bon pour `<ConfirmModal>` + `<Avatar>`. |
| `/caisse` | Moyenne-haute | Touche au métier financier (transferts P2P, validation), risque plus élevé de régression. |
| `/profil` | Faible-moyenne | Beaucoup de modals (PIN, push, docs) — bon pour valider `<ConfirmModal>` mais beaucoup de patterns à migrer en une fois. |

**Suggestion :** commencer par **`/admin/depots`** (simple et sans risque métier), puis enchaîner sur **`/admin/users`** si on a la marge. À valider avec Olivier avant l'étape 5.

### 5.3 Écrans **interdits** en phase 1 (rappel)

Décision de la mission : **ne pas toucher** car ils seront refondus en phase 2-5 :
- `src/app/dispatch/**` (DispatchClient, MissionDetailClient, NewMissionClient)
- `src/app/mission/**` (MissionListClient, DriverClient, mission/police, mission/new)

Si la migration des tokens Tailwind (étape 2) crée un effet de bord visuel sur ces écrans, on **vérifie qu'ils restent fonctionnels** mais on ne refait pas leur design.

---

## 6. Risques et points d'attention

### 6.1 Light mode forcé (décision verrouillée n°12)

**Risque :** l'app est aujourd'hui **dark only en dur** (`body { background: #0F0F0F; color: #ffffff }`). Le passage à light par défaut va **inverser** l'apparence partout.

**Stratégie suggérée :**
1. Étape 2 : tokens Tailwind avec **les deux thèmes** définis via classes `.theme-light` et `.theme-dark` sur `<html>` (comme dans le mockup v3)
2. Étape 3 : `ThemeProvider` initialise `theme-light` par défaut sur `<html>` (au mount), lit le `localStorage` pour basculer en `theme-dark` si l'utilisateur a choisi
3. Les écrans existants utilisent encore les hex hardcodés `#0F0F0F` etc. → ils seront **toujours sombres** même si le thème est light, tant qu'on ne les a pas migrés (effet attendu, pas une régression)
4. Après migration progressive (phase 2-5), tous les écrans suivront le thème

**Décision à valider Olivier :** est-ce qu'on tolère pendant la transition que les écrans non migrés (ex: dispatch list) restent en dark visuellement, même si l'utilisateur a choisi light ? Ou faut-il forcer un thème uniforme jusqu'à ce que tout soit migré ?

### 6.2 Effet de bord du changement `brand: #CC2222 → #E11D2E`

**Impact :** 128 occurrences de `bg-brand` et 13 de `bg-brand-dark` changent automatiquement de teinte. Le rouge devient **plus vif** (CC22 → E11D). Différence visible mais pas dramatique.

**Action :** lancer l'app en local après le changement, vérifier rapidement la cohérence sur 3-4 écrans.

### 6.3 ThemeColor PWA

`<meta name="theme-color">` actuellement = `#CC2222`. À migrer vers `#E11D2E` dans `src/app/layout.tsx` (impacte la barre d'état iOS/Android quand l'app est installée en PWA).

### 6.4 Fichiers email / PDF / API

Ces fichiers utilisent des hex hardcodés (`#1a1a1a`, `#fff`, `#CC2222`, etc.) pour générer des HTML rendus côté serveur (emails, PDFs).

**Décision suggérée :** **hors scope** de la phase 1 (visuels métier, pas de thème). À traiter séparément si besoin.

Liste : `src/app/api/missions/[id]/discharge-pdf/route.ts`, `src/app/api/cash/transfer/[id]/validate/route.ts`, `src/app/api/towsoft/error-notify/route.ts`, `src/app/api/tgr/route.ts`, `src/app/api/tgr/[id]/route.ts`, `src/app/api/tgr/[id]/take/route.ts`, `src/app/api/cron/daily-report/route.ts`, `src/app/api/cron/sync-cash-payments/route.ts`, `src/lib/receipt.ts`, `src/lib/emails.ts`, `src/lib/sumup.ts`.

---

## 7. Récapitulatif et plan d'action

### 7.1 Ce qui est à jour (à conserver)

- ✅ `next/font` partiellement utilisé (Inter chargé)
- ✅ Token `brand` propre (128 usages cohérents)
- ✅ Tailwind 3.4.6 avec config étendue
- ✅ `lucide-react` déjà installé
- ✅ `src/components/ui/` vide → terrain vierge
- ✅ Vocabulaire sémantique implicite cohérent (vert/jaune/orange/rouge)

### 7.2 Ce qui doit changer (phase 1)

| # | Action | Effort estimé |
|---|---|---|
| 1 | Étendre `tailwind.config.ts` (palette + fonts + radius + shadows) | 30 min |
| 2 | Charger Plus Jakarta Sans + JetBrains Mono via `next/font` | 15 min |
| 3 | Réécrire `globals.css` avec variables CSS thème (light/dark) | 30 min |
| 4 | Créer `<ThemeProvider>` + intégrer dans `Providers.tsx` | 30 min |
| 5 | Toggle theme dans `AppShell` (sidebar footer ou header) | 15 min |
| 6 | Créer 7 composants atomiques (`Button`, `Badge`, `Avatar`, `Panel`, `KpiCard`, `StatusPill`, `ConfirmModal`) | 3-4 h |
| 7 | Proof-of-concept sur 1 écran (`/admin/depots` ou autre) | 1 h |
| 8 | Mettre à jour spec section 11 (cocher items réalisés) | 5 min |

### 7.3 Ce qui reste pour les phases suivantes (hors phase 1)

- Migration des 45 fichiers UI vers les nouveaux tokens — **progressif**, un écran à la fois en phase 2-5
- Refonte des écrans dispatch/mission — phases 2-5
- Refonte modals existants vers `<ConfirmModal>` — phases 2-5
- Migration des emails/PDFs — non planifié
- Le mockup v3 contient également des classes utilitaires CSS (badge, panel, btn, kpi-tab, mission-card) — pas de migration directe, on s'inspire pour les composants React

---

## 8. Décisions à valider par Olivier avant étape 2

1. **Écran(s) du proof-of-concept étape 5** : OK pour `/admin/depots` puis `/admin/users` (suggestion ci-dessus) ?
2. **Tolérance pendant la transition** : on accepte que les écrans non migrés (dispatch, mission) restent visuellement en dark même si l'utilisateur choisit light ? Ou on attend la migration complète avant d'activer le toggle ?
3. **Emails/PDFs** : OK qu'ils restent sur leurs hex actuels jusqu'à un éventuel chantier dédié ?
4. **Variants `Button`** : la spec liste `primary | secondary | ghost | danger`. La phase 1 du prompt mentionne aussi un état `loading` (spinner intégré) et des slots icon left/right — confirmé ?
5. **Mapping avatars** : 5 utilisateurs nommés (Mobi/Jonathan/Bovy/Palm/Momo). Question : le matching se fait-il par `user.id` (UUID Supabase) ou par `user.name` ? Et pour les futurs chauffeurs, on utilise un fallback hash → couleur ?
6. **Éléments hors phase 1** : on garde le `<Avatar status-dot>` (online/busy/offline) ; mais le mapping statut → dot couleur est-il déterminé par le `users.online_status` Supabase ou côté client par `users.last_location_updated_at < 60s` ?
7. **Toggle de thème — emplacement** : sidebar footer (à côté de la photo de profil et du logout) ? ou en haut à droite de l'AppShell ?

---

**Fin du rapport.** Prêt pour validation puis étape 2 (Tailwind + fonts).
