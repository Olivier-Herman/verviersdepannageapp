# VD Soft — verviers-app (Verviers Dépannage)

Application métier de Verviers Dépannage : dépannage, remorquage, fourrière, facturation, agent mail.
Dépôt `Olivier-Herman/verviersdepannageapp`, prod sur Vercel (`app.verviersdepannage.com`).
L'app mobile est un wrapper Capacitor dans le dépôt séparé `verviersdepannageapp-mobile` : il charge le site web,
donc tout déploiement web s'applique immédiatement à tous les téléphones, anciens APK compris.

## Stack
- Next.js 14.2 (App Router dans `src/app`), React 18, TypeScript, Tailwind, PWA via `next-pwa` (service worker).
- Supabase (Postgres). Migrations dans `supabase/migrations/` (377 au 27/09/2026), projet prod `kwfhddlebmssymbflxgj`.
  Client service_role : `createAdminClient` dans `src/lib/supabase.ts`.
- NextAuth + Azure AD. Microsoft Graph pour les boîtes mail (info@, administration@, fourriere@).
- Odoo par RPC (`src/lib/odoo.ts`) : Odoo tient les factures et les clients, VD Soft tient le parc et les fiches.
- Vercel : hébergement et une quarantaine de crons dans `vercel.json`.
- Anthropic SDK (extraction de documents, agent mail) ; modèle centralisé dans `src/lib/anthropic-model.ts`.
- Google Maps Places (navigateur), OpenRouteService (routage), Capacitor (caméra, géoloc, push).
- Connecteurs assisteurs automatiques : Kaze (IMA), Touring COMEX, VAB Comet, AXA go&assist, Allianz/Hexalite
  (Mondial = Allianz). Les autres sources (Ethias, Vivium, Ardenne, P&V, AG) sont encodées à la main.
- App chauffeur bilingue fr + sq : `src/lib/i18n/dictionaries/fr.ts` et `sq.ts`, `<T k="…" />` et `t()`.

## Commandes
```
npm ci                                   # dépendances (package-lock.json)
npm run dev                              # http://localhost:3000
npx tsc --noEmit && npm run build        # prebuild = scripts/check-hardcode.mjs (refuse ids Odoo, montants €, boîtes mail en dur)
supabase db push --dry-run               # puis supabase db push ; SUPABASE_ACCESS_TOKEN vient de .env.local
supabase migration list
npx tsx --env-file=.env.local --tsconfig tsconfig.json <script.ts>   # scripts ponctuels (dossier scripts/)
```
Variables d'environnement : `.env.example` (NextAuth, Azure AD, Supabase, Odoo, Google Maps). `.env.local` n'est pas commité.

## Règles imposées par Olivier
Git et déploiement
- `git add` avec les fichiers nommés, jamais `-A` : le dépôt porte en permanence du WIP d'Olivier. `git diff --cached --stat` avant de commiter.
- Build vert avant tout push, tout en `&&` : `npx tsc --noEmit && npm run build && git add … && git commit … && git push`. Jamais `;` entre le build et le push.
- Pousser au plus une fois par heure, en lots, sauf panne (coût des builds Vercel). Dire ce qui est commité mais pas poussé.
- Checkout partagé avec d'autres sessions : `pgrep -f "next build"` avant de builder ; jamais `git reset --hard` ni `git stash` ; en cas de conflit, build et push depuis un worktree jetable.
- Migrations : je les applique moi-même avec `supabase db push`, `--dry-run` d'abord (une migration d'une autre session peut être en attente). Jamais deux migrations avec le même horodatage. Chaque migration finit par `notify pgrst, 'reload schema';`.
- Zéro valeur métier en dur (ids Odoo, montants, boîtes mail) : `app_settings` via `src/lib/settings/business-registry.ts` ou les grilles tarifaires. Le prebuild refuse le build sinon.

Navigation et UI
- Nouvelle page admin = tuile dans `src/app/admin/page.tsx` + entrée dans `src/app/admin/AdminNav.tsx`, même commit. Pas d'ajout à la barre de gauche (`nav-items.ts`) sans demander. Sous-page d'un hub : tuile du hub + section niveau 2 de `nav-tree.ts`.
- Pas de « Odoo » dans les libellés utilisateur, sauf le bouton « Ouvrir dans Odoo ».
- Textes lus par un utilisateur final (modes d'emploi, aide, tests) : pas de jargon (URL, statuts BDD, cron, API, modal).
- Modals : fermeture par ✕ ou bouton, jamais au clic sur le fond. Thème clair : texte -700/800/900 sur fond -50/-100.
- Modes d'emploi `mode-emploi-*.html` mis à jour dans le même commit que toute modification fonctionnelle visible.
- App chauffeur : valider en français d'abord, puis traduire ; toute clé ajoutée dans `fr.ts` ET `sq.ts`.

Métier
- Encaissement bureau = Odoo ; VD Soft n'encaisse que via le chauffeur. Encaisser ≠ clôturer (seul « Terminer » passe en `to_invoice`). Montant affiché au chauffeur = TVAC, tarifs en base HTVA. Un prix encaissé est figé (`src/lib/facturation/freeze-collected.ts`).
- Gardiennage = nuits passées (`nightsBetween`, `src/lib/parc/nights.ts`), jamais le jour d'entrée ; il s'arrête dès que l'adresse réelle de relivraison est connue.
- Le lien assisteur fait foi (id Hexalite, Comet, Kaze, COMEX) : jamais gater un hook sur `source ===`.
- Couvert ou non couvert se décide AVANT l'intervention ; pas de tranchage autoroute pour un assisteur.
- Relivraison : règle par assisteur portée par la grille (`rel_mode`), aucune exception par source dans le code.
- Un AVP ne part jamais en état de frais au Parquet. Pas de relance automatique au Parquet. Un réquisitoire est un PDF ou JPG, jamais un HTML.
- Mails automatisés sortants : `administration@verviersdepannage.com` (états de frais fourrière : fourriere@). Ne jamais dévoiler l'automatisation à un tiers.
- Clôture chauffeur définitive : pas de fenêtre de re-clôture, une erreur se corrige côté dispatch.
- Pas de rejeu des mails passés : on corrige pour le futur, l'historique sert de corpus de test.
- Odoo : jamais supprimer une ligne d'un `sale.order` confirmé (quantité à 0) ; pas de rapport d'intervention attaché à une facture ; auditer les champs avant tout RPC (Odoo 19 a retiré `res.partner.mobile`).

## Pièges connus
- Next met en cache les fetch serveur : `cache: 'no-store'` sur tout fetch Supabase, Graph ou self-fetch. Une page qui lit Supabase côté serveur porte `export const dynamic = 'force-dynamic'`.
- `app_settings.value` est du TEXTE JSON : `JSON.parse` à la lecture.
- Nouvelle table : `GRANT ALL … TO service_role` + `notify pgrst` obligatoires, sinon 403 ou vide silencieux (vaut aussi pour `supabase db push`). Tester un `select … limit 1` en service_role après la migration.
- `users.modules` n'existe pas : contrôle d'accès via `sessionAccess()` (`src/lib/access.ts`). `role` et `roles[]` coexistent : filtrer avec `.or('role.in.(…),roles.ov.{…}')`.
- `DELETE` sur `incoming_missions` : toujours `status IN (…)` explicite, jamais `NOT IN` (470 fiches de parc perdues le 05/06/2026). `SELECT … GROUP BY status` avant.
- Après un UPSERT en lot, `order by created_at` n'est pas déterministe : `order by id`.
- Géocodage Google côté serveur non activé : géocoder dans le navigateur (`verifyAddressViaPlaces`) et persister lat/lng. Sur iPhone, suggestions en boutons inline, pas le widget Autocomplete. Waze : coordonnées, jamais un texte dans `ll=`.
- Siabis (`police_snc`) n'a pas de ligne dans `source_tariffs` : moteur séparé `src/lib/snc/pricing.ts`.
- COMEX : jamais un champ date vide (`""`), sinon 500 ; omettre le champ.
- Jeton Graph : réessayer une fois avec `getAppOnlyToken(true)` sur 401. Un cron en échec doit se voir à l'écran.
- Capacitor : jamais `await` sur le proxy de `registerPlugin` (blocage silencieux). Un fix web qui dépend du natif se gate sur le marqueur `VDNav/` de l'user-agent.
- UI figée après un déploiement = service worker PWA : recharger deux fois ou vider le cache avant de débugger.
- `window.open` après un `await` est bloqué : pré-ouvrir les onglets dans le clic.
- « Tarif à calculer » : lire la raison affichée avant de corriger.

## Façon de travailler
- Un sujet à la fois. Un message ambigu d'Olivier vise presque toujours le sujet le plus lourd en cours, pas le plus récent.
- Infos « pour plus tard » : mémoriser, accuser réception en une ligne, continuer. Sauf « URGENT ».
- Vérification en 4 temps : problème, fix, audit de toute l'app pour le même motif, fix partout.
- Auditer avant d'introduire une source, clé, statut ou enum (grep large). Auditer depuis la règle métier énoncée par Olivier, pas depuis le code existant.
- Mode scénario : un scénario de bout en bout à la fois, ne corriger que ce qui bloque l'étape en cours.
- Proactif et exhaustif : inventorier tous les champs d'emblée ; checklist UX avant commit (warnings actionnables, états vides, chargement, confirmations, zones tactiles ≥ 44 px) ; proposer des idées en fin de tâche. Livrer au niveau de la maquette.
