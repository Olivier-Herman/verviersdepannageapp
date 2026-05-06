# Composants atomiques — Phase 1

**Date :** 2026-05-06
**Emplacement :** `src/components/ui/`
**Statut :** créés, non encore intégrés aux écrans (Phase 2-5).

Tous les composants utilisent les tokens Tailwind définis à l'étape 2
(`brand`, `success`, `warning`, `alert`, `critical`, `info`, `purple`, `ink`,
`surface`, `page`, `border`) — aucune couleur hardcodée. Bascule automatique
light/dark via les CSS vars du thème (étape 3).

Import canonique :
```ts
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { StatusPill, type MissionStatus } from '@/components/ui/StatusPill'
import { Avatar, getAvatarColor, getInitials } from '@/components/ui/Avatar'
import { Panel } from '@/components/ui/Panel'
import { KpiCard } from '@/components/ui/KpiCard'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
```

---

## 1. Button — `src/components/ui/Button/`

**Variants :** `primary` | `secondary` (défaut) | `ghost` | `danger` | `success`
**Sizes :** `sm` | `md` (défaut) | `lg`
**États :** `loading` (spinner Loader2 + désactivé), `disabled`, `fullWidth`
**Slots :** `iconLeft`, `iconRight` (idéalement icône Lucide)
**Accepte tous les attributs HTML d'un `<button>` (onClick, type, form, …).**

Hover primary : `bg-brand-hover` + élévation `-translate-y-px` + ombre `shadow-brand-hover`.

```tsx
<Button variant="primary" iconLeft={<Save size={16} />}>Sauvegarder</Button>
<Button variant="danger" size="sm" loading={isDeleting}>Supprimer</Button>
<Button variant="ghost" onClick={onClose}>Annuler</Button>
<Button variant="success" fullWidth>Valider le devis</Button>
```

> ⚠ Marqué `'use client'` car accepte `onClick` (handler).

---

## 2. Badge — `src/components/ui/Badge/`

**Variants :** `neutral` (défaut) | `info` | `success` | `warning` | `alert` | `critical` | `brand` | `purple`
**Sizes :** `sm` | `md` (défaut)
**Slot :** `leading` (emoji ou icône avant le texte)

Composant pur (server-friendly).

```tsx
<Badge variant="info" leading="🛡️">TOURING</Badge>
<Badge variant="warning" leading="📍">Sur place</Badge>
<Badge variant="critical" size="sm">⚠️ &gt;1H</Badge>
```

---

## 3. StatusPill — `src/components/ui/StatusPill/`

Spécialisation de `<Badge>` pour les statuts mission. Mapping `status → (variant, emoji, label)` centralisé dans [`mapping.ts`](../src/components/ui/StatusPill/mapping.ts).

**Statuts :** `nouveau` · `a_assigner` · `en_cours` · `en_route` · `sur_place` · `en_parc` · `a_facturer` · `termine` · `annule`

```tsx
<StatusPill status="sur_place" />          // → "📍 Sur place" (warning)
<StatusPill status="a_facturer" size="sm" /> // → "💰 À facturer" (success)
```

Le mapping est exporté (`STATUS_MAPPING`) — on peut l'utiliser ailleurs (ex: lignes de tableau, timeline) sans repasser par `<StatusPill>`.

---

## 4. Avatar — `src/components/ui/Avatar/`

**Sizes :** `xs` | `sm` | `md` (défaut) | `lg`
**Status (optionnel) :** `available` | `busy` | `offline` (affiche un dot bordé en bas-droite)

**Couleurs (cf. [`colors.ts`](../src/components/ui/Avatar/colors.ts)) :**
- 5 utilisateurs core ont une couleur fixe : Mobi (rouge), Jonathan (bleu), Bovy (orange), Palm (vert), Momo (gris)
- Match par `userId` ou par prénom (premier mot lowercase)
- Fallback : hash de `email` (préféré, plus stable) ou `name` → palette de 8 gradients

**Initiales :**
- "Jonathan" → "J"
- "Frédéric Palm" → "FP"
- "Mobi - VD" → "M" (présence d'un séparateur non-lettre → 1ère lettre seule)

```tsx
<Avatar name="Jonathan" userId={7} size="md" status="busy" />
<Avatar name="Frédéric Palm" email="palm@vd.be" size="lg" status="available" />
<Avatar name="Inconnu" />  // fallback hash
```

Helpers exposés : `getAvatarColor()`, `getInitials()`.

---

## 5. Panel — `src/components/ui/Panel/`

Carte avec entête optionnel (équivalent d'une "Card with header").

**Props :**
- `title?` : si fourni, rend l'entête
- `icon?` : ReactNode (emoji ou icône Lucide), placée dans une "section-emoji" colorée
- `iconBg?` : `info` | `success` | `warning` | `alert` | `critical` | `purple` | `neutral` (couleur du fond de l'icône)
- `actions?` : ReactNode à droite du title (boutons sync, +ajouter, etc.)
- `noPadding?` : désactive le `p-4` du body (utile pour les tableaux pleine largeur)

Composant pur.

```tsx
<Panel title="Devis" icon="💰" iconBg="success" actions={<Button size="sm">Sync</Button>}>
  <DevisTable />
</Panel>

<Panel title="Photos" icon="📸" iconBg="purple">
  <PhotoGrid />
</Panel>

<Panel noPadding>
  <table className="w-full">…</table>
</Panel>
```

---

## 6. KpiCard — `src/components/ui/KpiCard/`

Bloc compteur avec gros chiffre (28px font-display extrabold), label uppercase et sous-titre optionnel.

**Props :**
- `label` (uppercase, en haut)
- `value` (le chiffre principal)
- `sub?` (sous-titre)
- `icon?` (emoji à côté du label)
- `active?` (true → fond gradient rouge marque + texte blanc)
- `onClick?` (rend la card cliquable, avec hover translateY)
- `minWidth?` (défaut '130px')

```tsx
<KpiCard label="🆕 Nouveau" value={3} sub="missions à confirmer" active />
<KpiCard label="En parc" value={45} icon="🅿️" onClick={() => setTab('parc')} />
```

> ⚠ Marqué `'use client'` car accepte `onClick`.

---

## 7. ConfirmModal — `src/components/ui/ConfirmModal/`

Modal de confirmation pour actions destructives ou critiques.

**Props :**
- `open` (boolean)
- `title` (string)
- `description?` (ReactNode)
- `confirmLabel?` (défaut "Confirmer")
- `cancelLabel?` (défaut "Annuler")
- `variant?` : `default` (CTA primary) | `danger` (CTA danger)
- `onConfirm`, `onCancel`
- `loading?` : désactive les boutons et le backdrop, met spinner sur OK

**Comportements :**
- Escape → `onCancel` (bloqué pendant `loading`)
- Clic sur backdrop → `onCancel` (idem)
- Body scroll bloqué tant que ouverte

```tsx
<ConfirmModal
  open={isOpen}
  title="Annuler la mission ?"
  description="Cette action est irréversible. Le chauffeur sera notifié."
  variant="danger"
  confirmLabel="Annuler la mission"
  onConfirm={handleCancel}
  onCancel={() => setIsOpen(false)}
  loading={isSubmitting}
/>
```

> ⚠ Marqué `'use client'` (gestion focus, escape, scroll-lock).

---

## Notes d'implémentation

- **Pas de Radix UI / Headless UI / shadcn** — vanilla React + Tailwind + lucide-react.
- **Backdrop ConfirmModal** : utilise `bg-black/40 backdrop-blur-sm`. Pas `bg-ink/40` car les modificateurs d'opacité Tailwind ne fonctionnent pas avec les couleurs déclarées en `var()`. Le noir 40% donne un dim universel propre pour les 2 thèmes.
- **`getInitials()` règle "Mobi - VD" → "M"** : si le nom contient un caractère non-lettre (ponctuation, tiret), on ne garde que la 1ère lettre. Implémenté via `/[^\p{L}\s]/u`.
- **Tag dynamique KpiCard** : si `onClick` est fourni → rendu en `<button>`, sinon `<div>`. Évite un `<button>` non interactif et le warning "missing type".
- **Composants serveur vs client** : Badge, StatusPill, Avatar, Panel sont tous server-friendly. Button, KpiCard, ConfirmModal sont marqués `'use client'` parce qu'ils acceptent des handlers ou utilisent des effets.

---

## Exemples d'usage en condition réelle

Deux écrans ont été migrés en proof-of-concept et servent de référence pour les
phases suivantes. Toute migration ultérieure doit suivre ces patterns.

### `/admin/depots` — pattern CRUD simple

Référence pour : layout `bg-page → bg-surface`, boutons CTA et actions, modal d'édition inline (pattern visuel équivalent à `<ConfirmModal>` avec form), suppression via `<ConfirmModal variant="danger">`.

Ce qu'on y voit en conditions réelles :
- `<Button>` avec tous les variants (`primary` "Nouveau dépôt", `ghost` "Modifier" et "Retour ←", `danger` "Supprimer", `primary` avec `loading` sur "Enregistrer")
- `<Badge variant="brand">` pour le tag "★ Par défaut"
- `<ConfirmModal variant="danger">` qui remplace un `confirm()` natif
- `inputCls` factorisée comme constante (DRY) — pas de composant `<Input>` en phase 1

Fichier : [`src/app/admin/depots/DepotsAdminClient.tsx`](../src/app/admin/depots/DepotsAdminClient.tsx)

### `/admin/users` — pattern matrice + avatars multi-users

Référence pour : `<Avatar>` multi-utilisateurs avec couleurs core (Mobi/Jonathan/Bovy/Palm/Momo) + fallback hash, mapping rôles → variants `<Badge>`, double UI mobile/desktop, modal d'édition fullscreen pour les permissions complexes (rôles).

Ce qu'on y voit en conditions réelles :
- **`<Avatar>` à 4 tailles** : `sm` (table desktop, ligne user), `md` (cards mobile + panel édition mobile), `lg` (header panel édition desktop)
- **Users inactifs** : `className="opacity-60"` conserve la couleur core mais signale visuellement l'état
- **Mapping rôles → variants `<Badge>`** :
  - `driver` → `neutral`
  - `dispatcher` → `info`
  - `admin` → `purple`
  - `superadmin` → `brand` (rouge marque, pouvoir maximal)
  - `partner` → `success`
- **Statut actif/inactif** → `<Badge variant="success|neutral">`
- **Modal de modification des rôles** : pattern fullscreen avec backdrop + panel `bg-surface` + checkboxes custom + `<Badge>` capitalize pour chaque rôle
- **Form "+ Nouvel utilisateur" inline** (accordion) — décision UX volontaire : modal réservé aux édits complexes, accordion pour 3 champs rapides
- **Composant local `<Toggle>`** restylé avec tokens (`bg-brand` actif / `bg-surface-hover` inactif) — pas de composant atomique Toggle en phase 1

Fichier : [`src/app/admin/users/UsersClient.tsx`](../src/app/admin/users/UsersClient.tsx)

---

## Migration des écrans (Phase 2-5)

Ces composants seront intégrés progressivement aux écrans suivants :

| Phase | Écrans cibles |
|---|---|
| Phase 1 — POC (terminé) | ✅ `/admin/depots` · ✅ `/admin/users` · ✅ `AdminLayoutClient` + `AdminNav` |
| Phase 2 (Pipeline & nav) | `/dispatch` (DispatchClient) |
| Phase 3 (Fiche v2) | `/dispatch/[id]` (MissionDetailClient) |
| Phase 4 (Devis intégré) | nouveau `<QuoteSection>` qui utilisera `Panel` + `Button` |
| Phase 5 (Imprévus) | refonte modals existants vers `<ConfirmModal>` |

---

**Fin du document.**
