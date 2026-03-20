# Verviers Dépannage — App PWA

Stack : **Next.js 14** · **Supabase** · **Vercel** · **NextAuth (Azure AD)**

---

## 🚀 Installation en 6 étapes

### 1. Prérequis
```bash
node -v   # doit être >= 18
npm -v    # doit être >= 9
```
Si Node n'est pas installé :
```bash
# Avec Homebrew (macOS)
brew install node
```

### 2. Cloner et installer
```bash
git clone https://github.com/TON_COMPTE/verviers-depannage-app.git
cd verviers-depannage-app
npm install
```

### 3. Variables d'environnement
```bash
cp .env.example .env.local
# Ouvre .env.local et remplis toutes les valeurs
```

Générer le NEXTAUTH_SECRET :
```bash
openssl rand -base64 32
```

### 4. Azure AD — Enregistrer l'application
1. Va sur https://portal.azure.com
2. **Azure Active Directory** → **App registrations** → **New registration**
3. Nom : `Verviers Dépannage App`
4. Redirect URI : `https://app.verviersdepannage.com/api/auth/callback/azure-ad`
   - Pour le dev local, ajouter aussi : `http://localhost:3000/api/auth/callback/azure-ad`
5. Copie le **Application (client) ID** → `AZURE_AD_CLIENT_ID`
6. Copie le **Directory (tenant) ID** → `AZURE_AD_TENANT_ID`
7. **Certificates & secrets** → **New client secret** → Copie la valeur → `AZURE_AD_CLIENT_SECRET`

### 5. Supabase — Créer le projet et la DB
1. Va sur https://supabase.com → New project
2. Note l'URL et les clés → remplis `.env.local`
3. Exécute la migration dans **SQL Editor** de Supabase :
   ```
   Colle le contenu de : supabase/migrations/001_initial_schema.sql
   ```
4. Créer un bucket Storage nommé `documents` (private)

### 6. Lancer en développement
```bash
npm run dev
# Ouvre http://localhost:3000
```

---

## 🌐 Déploiement sur Vercel

```bash
# Installer Vercel CLI
npm i -g vercel

# Déployer
vercel --prod
```

**Dans Vercel** :
- Settings → Environment Variables → ajouter toutes les variables de `.env.example`
- Settings → Domains → ajouter `app.verviersdepannage.com`

**DNS (chez ton registrar)** :
```
CNAME  app  →  cname.vercel-dns.com
```

---

## 📁 Structure du projet

```
src/
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/    # NextAuth Azure AD
│   │   ├── odoo/                  # Sync Odoo
│   │   ├── vies/                  # Validation TVA
│   │   ├── places/                # Google Places proxy
│   │   └── vehicles/              # Marques/modèles
│   ├── admin/                     # Interface backstage
│   │   ├── users/                 # Gestion utilisateurs + modules
│   │   ├── modules/               # Paramétrage listes
│   │   └── settings/              # Config appels, raccourcis
│   ├── dashboard/                 # Accueil app
│   ├── encaissement/              # Module encaissement chauffeur
│   ├── depose/                    # Module dépose véhicule
│   ├── avance-fonds/              # Module avance de fonds
│   ├── documents/                 # Module documents
│   └── services/                  # Dépannage / Fourrière / Rent A Car / TGR
├── components/
│   ├── ui/                        # Composants réutilisables
│   ├── forms/                     # Formulaires
│   └── layout/                    # Navigation, header, etc.
├── lib/
│   ├── supabase.ts                # Clients Supabase
│   ├── odoo.ts                    # Connecteur Odoo JSON-RPC
│   └── vies.ts                    # VIES API
├── hooks/                         # Custom React hooks
├── types/                         # Types TypeScript
└── middleware.ts                  # Protection routes + contrôle modules
supabase/
└── migrations/
    └── 001_initial_schema.sql     # Schéma complet DB
```

---

## 🔐 Gestion des droits

Les modules accessibles par user se gèrent dans **Admin → Utilisateurs**.

| Rôle | Accès |
|------|-------|
| `driver` | Modules assignés uniquement |
| `dispatcher` | Tous les modules opérationnels |
| `admin` | Tout + backstage admin |
| `superadmin` | Tout sans restriction |

---

## 🔗 Connexion Odoo

La sync Odoo se fait via l'API route `/api/odoo`.
Les credentials sont côté serveur uniquement (jamais exposés au browser).

Flux : Intervention créée dans Supabase → bouton "Sync Odoo" → création partenaire + facture dans Odoo → ID Odoo sauvegardé dans Supabase.
