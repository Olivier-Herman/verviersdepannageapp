# Guide dispatcher — VD Soft

Guide d'usage de l'app VD Soft côté **dispatcher / admin**.

---

## 📲 Accès

- **Web** : https://app.verviersdepannage.com (Mac, PC, tablette, mobile)
- **iPhone** : app VD Soft via TestFlight (ou App Store quand publié)
- **Apple Watch** : compteur missions en attente + alerte dérogation (optionnel)

Connexion : Microsoft (Azure AD) recommandé pour single sign-on avec ton compte VD.

---

## 🎯 Vue d'ensemble — Onglet `/dispatch`

L'écran principal du dispatcher avec 6 onglets :

| Onglet | Contient |
|---|---|
| **En commande** | Missions reçues mais pas encore confirmées (status `new`) |
| **En attente** | Missions confirmées, en attente d'assignation chauffeur (status `dispatching`) |
| **Assignées** | Mission assignée à un chauffeur, attente acceptation (status `assigned`/`accepted`) |
| **En cours** | Chauffeur en route ou sur place (status `in_progress`/`delivering`) |
| **En parc** | Véhicules garés dans un de tes parcs (status `parked`) |
| **Terminées** | Cloturées par chauffeur, en attente facturation (status `to_invoice`) |

**Vue carte** : icône en haut à droite — affiche les missions actives sur une carte (uniquement les géocodées, donc à partir de "En attente").

---

## 📥 Arrivée d'une mission

Les missions arrivent automatiquement via :
- **VAB** : scraper Comet toutes les 5 min
- **Touring** : email IMAP
- **IMA / Mondial / Ethias** : email IMAP avec parsing OCR/AI

→ Tu reçois une **notification** quand une nouvelle mission arrive.

---

## ✅ Workflow standard

### 1. Vérifier la mission "En commande"
- Tap sur la card pour ouvrir la fiche
- Vérifie l'adresse, le client, le type de mission
- Modifie si nécessaire (type, adresse, etc.)

### 2. Confirmer la mission
- Bouton **Confirmer** → crée le dossier Odoo automatiquement + passe en "En attente"
- OU **Assigner directement à un chauffeur** depuis "En commande" → confirme + assigne en une étape

### 3. Assigner un chauffeur
**Option A — Manuel** : sélectionne un chauffeur dans le dropdown → **Assigner**

**Option B — Auto-dispatch** ⚡ : bouton **Auto** sur la card
- Le système envoie une notification au chauffeur de garde le plus proche
- Si pas de réponse en 60s → appel téléphonique automatique
- Si refus → tentative suivante
- 3 tentatives max → escalade au dispatcher de garde

Pour stopper l'auto-dispatch : bouton **🛑 Stop** (la mission reste en "En attente").

### 4. Suivi en temps réel
- Statut chauffeur visible (assigned → accepted → in_progress → on_site → completed)
- Localisation GPS chauffeur sur la carte si "En service"
- ETA estimé sur la fiche

### 5. Validation facturation
- Quand le chauffeur clôture → statut "Terminée" (`to_invoice`)
- Onglet **Facturation** : valide les missions une par une → passage en Odoo invoice

---

## 🚨 Dérogation paiement

Si un chauffeur déclenche une **demande de dérogation** (geste 5-tap sur sa Watch ou iPhone) :

1. **Notification urgente** : push + bandeau rouge dans la sticky bar (visible depuis n'importe quelle page)
2. Tap "🆘 DÉROGATION À VALIDER" → tu arrives sur la fiche dispatch de la mission
3. Encart amber avec 3 actions :
   - **Annuler le montant** : la mission n'a plus de montant à encaisser
   - **Ajuster** : nouveau montant
   - **Refuser** : mission inchangée (le chauffeur doit encaisser)
4. Le chauffeur reçoit ta réponse instantanément

---

## 🅿️ Mise en parc

Quand un véhicule reste chez nous (parc) :
- Le chauffeur le met en parc via l'app
- Visible dans l'onglet "En parc" + sur la fiche du véhicule (Odoo)
- Bouton **Relivrer** sur la fiche → crée automatiquement une mission de relivraison vers la destination finale

---

## ⌚ Apple Watch (dispatcher)

Tu vois sur ta Watch :
- **Compteur missions en attente** : nombre de missions `new` + `dispatching`
- **Top 5 missions urgentes** : avec source (VAB, Touring…) et ville
- **Alerte dérogation** : si un chauffeur en demande une, vibration immédiate

⚠️ L'**assignation à un chauffeur** depuis la Watch n'est **pas encore disponible** (prévu Phase 2). Pour l'instant, garde l'iPhone pour ça.

---

## 👥 Administration

Onglet **/admin** (visible si rôle admin/superadmin) :
- **Utilisateurs** : créer / modifier / désactiver / supprimer (PIN requis pour suppression)
- **Modules** : assigner les modules accessibles à chaque user
- **Sources** : configurer les sources de missions (clients par défaut, etc.)
- **Décharges** : catalogue des types de décharges + schéma dégâts
- **Notifications** : préférences par type / par user
- **Garde** : planning des chauffeurs de garde

---

## 🔔 Notifications dispatcher

Tu reçois automatiquement :
- Nouvelle mission reçue
- Chauffeur accepte / refuse une mission
- Mission terminée (à facturer)
- Dérogation paiement demandée
- Auto-dispatch épuisé (escalade)
- Email parsing erreur

Tu peux les désactiver / customiser dans `/admin/notifications`.

---

## 🔋 Mode économie

Le dispatch tape Supabase Realtime en continu (badges, listes live). Si tu remarques une baisse de réactivité :
- Refresh la page (F5)
- Vérifie ta connexion réseau

---

## 🆘 Problème technique

- Bug app → screenshot + contact Mobi
- Bug données (mission perdue, statut bloqué) → SQL via Supabase Studio (Mobi a l'accès)
- Mission "parse_error" → onglet `/admin/missions/errors` → relire le contenu raw + retry parser
