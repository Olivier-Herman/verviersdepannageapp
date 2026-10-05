# Savoir des agents « Achats et paiements » (Florent) et « Relation comptable » (Benoît) — Verviers Dépannage

> **Décisions d'Olivier du 04/10/2026 : voir [decisions-olivier.md](decisions-olivier.md). Elles priment sur les « à confirmer » de ce document.**

> Date de rédaction : **04/10/2026**
> Public : agents IA de **HOOS** dédiés à Verviers Dépannage (pas des employés de VD) qui reprendront une partie du travail d'Olivier (**« Mobi »** ou **« IT »**, jamais « la direction ») :
> - **Florent** : encodage et vérification des factures d'achat, préparation du fichier de paiement ;
> - **Benoît** : relation avec le bureau comptable externe, en particulier les paiements sans pièce.
> Périmètre : **société 1 = Verviers Dépannage SA** dans l'ERP (Odoo 19). Dépannage Riga (société 2) et DGJ VHU (société 3) ne sont cités que lorsqu'ils interfèrent.
> Sources : code de VD Soft (chemin:ligne), mémoire des décisions d'Olivier (nom du fichier mémoire), règles de session compta (`.claude/skills/compta-vd/SKILL.md`), **constats faits en lecture seule dans l'ERP le 04/10/2026** (notés « constat ERP 04/10 »).
> Convention : **« à confirmer »** = non tranché ou non vérifié ; ne jamais le présenter comme acquis. Exemples des situations d'examen : fournisseurs et montants **fictifs**.
> À lire avec `../equipe.md` (qui valide quoi) et `../facturation.md` (côté ventes).

---

## 0. En une page

- **L'ERP n'est pas la comptabilité.** La comptabilité est tenue par le cabinet **THG (Malmedy)** ; dans l'ERP, les écritures servent à **solder** les factures et à **lettrer** la banque. Le critère de justesse ici : la facture se solde-t-elle, chaque paiement est-il attribué une fois et une seule (mémoire `feedback_compta_chez_comptable_externe.md`).
- **Les factures d'achat arrivent par cinq voies** : Peppol (environ 3 sur 4 en 2026), mail transféré vers la boîte d'encodage du journal d'achats (dont l'agent mail de VD Soft), encodage manuel par Mobi (courrier, tickets, portails), et VD Soft lui-même (avances de fonds, amendes, fiches de paie).
- Elles atterrissent toutes dans le journal **« Purchases » (Achats, préfixe BILL)**, sauf les fiches de paie (journal **« Fiches de paie »**). Elles naissent en **brouillon** ; Mobi les **valide** (sauf les fiches de paie, postées directement par VD Soft).
- **Rôle futur de Florent** : encoder et **vérifier les chiffres** (fournisseur, numéro, date, montants, TVA, pièce jointe, doublon). **Pas d'imputation comptable** : le compte de charge n'est pas son sujet, le comptable reclasse. **L'export de la nuit vers le comptable reste tel quel.**
- **Fichier de paiement** : aujourd'hui Mobi crée dans l'ERP un **lot de virements SEPA** sur le compte ING, l'ERP produit un fichier `SCT-ING1-….xml`, il est chargé dans la banque et **Momo signe**. Rôle futur : **Florent prépare, Momo signe.** Florent ne signe jamais et ne touche jamais aux coordonnées bancaires d'un fournisseur.
- **Le comptable (Maureen, THG)** a un accès à l'ERP et y pose ses questions **en commentaire sur les lignes de banque** (« pour quelle facture ? », « détail du lettrage ? », « facture manquante »). Rôle futur de **Benoît** : retrouver la pièce, préparer la réponse, la faire valider. **Rien ne part sans accord.**
- Règle que le comptable a posée : **une facture déjà reprise dans une déclaration TVA ne se modifie plus** → note de crédit puis nouvelle facture.

---

## 1. Vocabulaire

| Terme | Sens ici |
|---|---|
| **Facture d'achat / facture fournisseur** | Facture reçue d'un fournisseur. Dans l'ERP : une pièce de type « facture fournisseur » ; une note de crédit reçue est une « note de crédit fournisseur ». |
| **Brouillon / Comptabilisée** | Brouillon = pas encore validée, sans numéro définitif (numéro « / »). Comptabilisée = validée, numéro `BILL/AAAA/MM/NNNN`, plus modifiable sans repasser en brouillon. |
| **Peppol** | Réseau belge et européen de factures électroniques. Une facture Peppol arrive **seule** dans l'ERP, avec un fichier structuré (XML) et en général un PDF. |
| **Boîte d'encodage** | Adresse mail propre au journal d'achats : tout PDF envoyé dessus crée une facture fournisseur **brouillon** dans la bonne société. Une boîte par société. |
| **Agent mail** | Robot de VD Soft qui lit info@ (deux dossiers) et administration@ ; pour les factures fournisseurs, il vérifie si elles sont déjà dans l'ERP et sinon les transfère à la boîte d'encodage. |
| **Avance de fonds** | Argent avancé par un chauffeur ou le bureau pour le compte d'un client (pièce, carburant, péage, réparation…). VD Soft crée un devis de refacturation **et** envoie la facture du fournisseur pour encodage. |
| **Lot de paiement / fichier de paiement** | Groupe de virements fournisseurs préparé dans l'ERP ; l'ERP en sort un fichier SEPA (XML) à charger dans la banque. |
| **Domiciliation** | Prélèvement automatique par le fournisseur (énergie, télécom, leasing…). Pas de fichier à préparer : il faut seulement lettrer. |
| **Lettrage** | Relier une ligne de banque au(x) document(s) qu'elle solde. Règle : **une ligne par document**. |
| **Paiement sans pièce** | Ligne de banque sortante (ou entrante) qu'on ne peut relier à aucun document : facture absente, ticket manquant, double paiement, opération diverse non expliquée. |
| **OD** | Opération diverse : écriture manuelle (commissions cartes, écarts d'arrondi, régularisations). |
| **THG** | Cabinet comptable externe (Malmedy). Interlocutrice : **Maureen**. |
| **Export de la nuit** | Transfert automatique des écritures de l'ERP vers le logiciel du comptable. **Ne pas y toucher.** |

---

## 2. Qui fait quoi

| Tâche | Aujourd'hui | Demain (cible) | Ce que l'agent ne fait jamais |
|---|---|---|---|
| Recevoir les factures Peppol | Automatique (ERP) | Automatique | — |
| Envoyer un PDF reçu par mail à l'encodage | Agent mail VD Soft + Mobi + Momo (transferts à la main) | Agent mail + Florent (contrôle) | Transférer une facture d'une autre société vers la boîte VD |
| Vérifier un brouillon (chiffres, doublon, pièce) | Mobi | **Florent** | Choisir ou changer un compte de charge |
| Valider (comptabiliser) une facture d'achat | Mobi | **à confirmer** (Florent après contrôle, ou Mobi) | Valider une facture douteuse « pour avancer » |
| Préparer le lot de virements | Mobi | **Florent** | Ajouter ou modifier un compte bancaire fournisseur |
| Charger le fichier en banque | Mobi (**à confirmer**) | **à confirmer** | Signer |
| Signer les virements | **Momo** | **Momo** | — |
| Lettrer la banque | Mobi (+ robots VD Soft pour les encaissements) | **à confirmer** pour Florent / Benoît | Rouvrir un lettrage correct |
| Répondre au comptable | Mobi (dans l'ERP, sous son nom) | **Benoît** prépare, Mobi valide | Envoyer ou publier sans accord |
| Décider d'un remboursement / double paiement | Momo | Momo | Promettre un remboursement |

Sources : rôles cibles = consigne d'Olivier pour cette vague (04/10/2026) ; « Momo décide des doubles paiements et remboursements » = `../equipe.md` §2 et §4 ; lots créés par Mobi = constat ERP 04/10 (les 41 lots de 2026 ont tous Mobi pour auteur).

---

## 3. Partie A — Factures d'achat

### 3.1 Ce qui est sûr

**Volumes (constat ERP 04/10, société 1, factures datées de 2026)**
- 960 factures fournisseurs comptabilisées de janvier à septembre (journal Achats + journal Fiches de paie), entre 87 et 124 par mois.
- **Origine** : 712 sont arrivées par **Peppol** ; 58 portent une adresse d'expéditeur (créées par mail : 26 transférées depuis info@, 18 depuis la boîte de Mobi, 14 depuis administration@ = envois de VD Soft) ; 103 ont été **encodées à la main par Mobi** ; 162 ont été créées par VD Soft (106 fiches de paie, 56 achats : amendes et autres).
- La lecture automatique de l'ERP (reconnaissance de texte sur PDF) a servi pour environ 130 factures.
- Toutes les factures comptabilisées de 2026 sont marquées « revues ».
- **Au 04/10 : 37 brouillons** dans le journal Achats, le plus ancien du 27/08 ; 32 viennent de Peppol, dont 14 factures de Dépannage Riga (refacturation entre sociétés) reçues le 01/10.
- **Factures comptabilisées non payées dont l'échéance est passée (avant le 01/10)** : environ 81 factures, ~134 000 € ; **environ 73 % du montant est de la refacturation Dépannage Riga** (26 factures). Le reste : quelques fournisseurs et des personnes physiques (**à confirmer** : ce sont peut-être des fiches de paie ou remboursements payés autrement et non lettrés).

**Les cinq voies d'arrivée**

| Voie | Comment | Où ça arrive | Source |
|---|---|---|---|
| **Peppol** | Le fournisseur envoie sa facture électronique ; l'ERP va chercher les nouveaux documents **toutes les 4 heures**. | Brouillon, journal Achats, avec le fichier structuré. | Constat ERP 04/10 (tâche planifiée « PEPPOL: retrieve new documents ») ; ex. Paynovate et AS 24 Belgique arrivent par Peppol (`.claude/skills/compta-vd/SKILL.md:26` et `:31`). |
| **Mail → boîte d'encodage** | Le PDF est **transféré** à la boîte d'encodage de la société. Une boîte par société : Verviers Dépannage, Dépannage Riga, DGJ VHU. | Brouillon, journal Achats de la bonne société, PDF joint. | `src/lib/mail-agent/handlers/fournisseur.ts:23-27` ; mémoire `project_agent_mail_factures_fournisseurs.md`. |
| **Agent mail VD Soft** | Toutes les 15 min, il lit info@ (dossiers « 0 - Jona et Mobi » et « 0 - Scan Facturation » seulement) et toute la boîte administration@. Un mail avec pièce jointe et un sujet « facture / invoice / factuur / rappel… », qui ne vient pas d'un assisteur, est lu : société destinataire (le **numéro de TVA fait foi**, sinon le nom), recherche dans l'ERP (par numéro, sinon fournisseur + montant à 2 centimes près). **Déjà encodée** → mail rangé dans « Fournisseur Divers ». **Absente** → transférée à la boîte d'encodage puis rangée. **Rappel d'une facture absente** ou **destinataire inconnu** → « à vérifier » par un humain. Un même numéro n'est jamais traité deux fois. | Idem voie mail. | `fournisseur.ts:32-40`, `:80-88`, `:91-108`, `:116-147` ; `src/lib/mail-agent/index.ts:94-100` et `:297-302` ; `vercel.json:63`. |
| **Courrier papier / ticket / portail** | Mobi encode à la main (ou scanne et transfère à la boîte d'encodage). Exemples connus : AS 24 ancien compte Pays-Bas (factures « 2026-SFC-… »), SumUp (facture mensuelle téléchargée dans l'espace SumUp), achats de véhicules à des particuliers (contrat de vente). | Journal Achats. | `.claude/skills/compta-vd/SKILL.md:27`, `:31`, `:33-36` ; mémoire `feedback_lettrage_ligne_par_document.md`. Un module « Courrier » (scan de tout le courrier, reconnaissance du destinataire) est **en cadrage, pas en service** (mémoire `project_courrier_bpost_et_taches_process.md`). |
| **VD Soft** | Trois flux : **avances de fonds**, **amendes**, **fiches de paie** (détail ci-dessous). | Achats (avances, amendes) ; Fiches de paie. | Voir 3.2. |

### 3.2 Ce que VD Soft crée lui-même

**Avance de fonds** (écran « Avance de fonds », chauffeur ou bureau)
1. Saisie : photo de la facture du fournisseur, plaque, montant **HTVA et TVAC** (TVAC obligatoire, pas de calcul automatique à 21 % à cause des factures étrangères), mode de paiement (cash, Bancontact, carte, virement), fiche liée facultative (`src/app/api/advances/route.ts:16-37`).
2. VD Soft crée dans l'ERP un **devis** « Avance de fonds — plaque » sur le client « Divers » pour la refacturation, et y joint la photo (`route.ts:62-84` ; `src/lib/odoo.ts:644-690`).
3. VD Soft **envoie la facture du fournisseur** (photo convertie en PDF) **à la boîte d'encodage** du journal d'achats, depuis administration@, avec le message « veuillez encoder et acquitter la facture jointe » : c'est ce mail qui crée la **facture d'achat brouillon** (`route.ts:89-108` ; `src/lib/emails.ts:448-452` ; réglage `odoo_purchase_email`).
4. Payée en **cash** → sortie de la caisse du chauffeur pour le montant TVAC (`route.ts:115-126`).
5. Si l'avance est liée à une fiche, la facture du dossier reprend une ligne « Avance de fonds — plaque du jj/mm/aaaa » et **joint le justificatif** (exception voulue à la règle « pas de PDF non comptable sur une facture ») (`src/lib/dossier/lines.ts:92-100` ; `src/lib/dossier/invoice.ts:292-305`).
- Volume : 15 avances de juin à août 2026, surtout payées par carte, presque toutes liées à une fiche (constat base VD Soft 04/10).

**Amendes** : VD Soft crée directement la facture fournisseur **brouillon** sur le fournisseur « Police Fédérale », journal Achats, ligne libre (date · lieu · plaque · chauffeur), **sans compte de charge ni TVA**, scan du PV joint ; Mobi la valide ; le statut remonte chaque matin (`src/lib/fines/odoo-bill.ts:8`, `:66-67`, `:88-97` ; `vercel.json:53` ; mémoire `project_amendes_odoo_facture_fournisseur.md`).

**Fiches de paie** : chaque fiche du secrétariat social devient une facture fournisseur **comptabilisée** (montant **net**) sur le travailleur, journal « Fiches de paie », PDF joint ; un net négatif devient une note de crédit. Objectif : que le virement de salaire se lettre tout seul. **Les salaires ne sont pas « comptabilisés » dans l'ERP** : le comptable fait l'éclaté depuis le secrétariat social (`src/lib/paie/push-odoo.ts:1-22`, `:67-71` ; mémoire `project_module_paie.md`). **Hors périmètre de Florent** (données sensibles) sauf décision contraire d'Olivier.

### 3.3 Contrôles à faire sur une facture d'achat (checklist de Florent)

1. **Bonne société** : le numéro de TVA du destinataire sur la facture. Verviers Dépannage, Dépannage Riga et DGJ VHU ont chacune leur numéro et leur boîte d'encodage (`fournisseur.ts:23-27`). Une facture adressée à une personne ou une autre société hors groupe **n'est pas** encodée chez VD : elle part à Mobi.
2. **Doublon** : même fournisseur + même numéro, ou même fournisseur + même montant à quelques jours. Cas fréquent : une facture reçue **par Peppol ET par mail** ; une facture déjà payée par carte puis reçue à nouveau ; une facture étrangère encodée TTC à la main puis importée HT (Circle K, `.claude/skills/compta-vd/SKILL.md:30`).
3. **Chiffres** : numéro de facture du fournisseur (champ référence), date de facture, échéance, montant HTVA, TVA, TVAC **identiques au PDF**, au centime.
4. **Pièce jointe** : le PDF (ou la photo) est attaché. Une facture sans pièce est la première question du comptable.
5. **TVA étrangère** (Luxembourg, France, Pays-Bas…) : elle n'est pas déductible ; la règle de traitement existe (Circle K) — **ne pas improviser**, signaler.
6. **Lien véhicule** quand la facture vise un véhicule (pneus, réparation) : le comptable demande « pour quel véhicule ? utilitaire ou voiture ? » (commentaire du 11/06/2026, constat ERP 04/10). Noter la plaque dans la description si elle figure sur la pièce.
7. **Achat de véhicule** : contrat de vente joint, ligne « Marque Modèle - Année (châssis) », sans TVA pour un particulier ; destination à préciser (flotte ou revente) — décision d'Olivier (`.claude/skills/compta-vd/SKILL.md:33-36` ; mémoire `project_riga_fournisseurs_thg_2026-09.md`).
8. **Refacturation Dépannage Riga** : elle arrive par Peppol en série (même montant plusieurs fois le même jour). Ce n'est **pas forcément** un doublon (plusieurs prestations au même forfait) : comparer les références, ne rien annuler sans Mobi.

### 3.4 Pièges connus

- **Ne jamais conclure « Riga n'est pas dans l'ERP »** : le compte de VD Soft est verrouillé sur la société 1 par défaut ; Riga et DGJ VHU se lisent en choisissant explicitement la société (`src/lib/odoo.ts:139-153` ; mémoire `feedback_odoo_rpc_force_company_1.md`).
- **Conséquence à signaler à Olivier** : la recherche « déjà encodée ? » de l'agent mail passe par ce verrou ; pour une facture **Riga ou DGJ VHU**, elle ne trouve jamais rien et la transfère à nouveau → **risque de doublon de brouillon** dans ces sociétés (un doublon Carcom a été constaté le 23/09, mémoire `project_riga_fournisseurs_thg_2026-09.md`). Sans effet pour la société 1. **Défaut à décrire à Olivier, pas à contourner.**
- **Brouillon qui traîne** : un brouillon n'est ni dans la déclaration TVA ni payable par lot. 37 brouillons au 04/10, le plus ancien a 5 semaines.
- **L'agent mail ne lit pas tout** : à info@, seulement deux dossiers ; un PDF arrivé ailleurs (boîte personnelle, autre dossier) n'est pas vu.
- **Assisteurs** (Touring, VAB, AXA, Ethias, IMA, Allianz, Europ Assistance…) : leurs mails « facture » sont des demandes ou des autofacturations, **pas** des factures d'achat (`fournisseur.ts:32`).
- **Ne pas confondre** « facture comptabilisée non envoyée » (vente, que le comptable appelle « proforma ») et brouillon d'achat.

### 3.5 Règles fermes (achats)

1. **Pas d'imputation comptable** par Florent : ni choix ni changement de compte de charge, ni débat sur la TVA déductible. Le signaler en une phrase si c'est franchement anormal, puis avancer (`feedback_compta_chez_comptable_externe.md`).
2. **L'export de la nuit vers le comptable reste tel quel** : aucune modification de réglage, de clé d'accès ou de journal.
3. **Une facture comptabilisée déjà reprise dans une déclaration TVA ne se modifie pas** : note de crédit puis nouvelle facture (commentaire du comptable du 05/08/2026, constat ERP 04/10). Dans le doute, **ne pas repasser une facture en brouillon** sans l'accord de Mobi.
4. **Jamais de suppression** ; préférer annuler, et seulement avec l'accord de Mobi (`.claude/skills/compta-vd/SKILL.md:14`).
5. **Une facture = une société** : la TVA du destinataire fait foi.
6. **Pas de rapport d'intervention ni de PDF non comptable** sur une facture (sauf justificatifs d'avance de fonds, voulus) : l'export comptable prendrait ce PDF au lieu de la facture (`../facturation.md` règle 5).
7. **Ne pas dévoiler l'automatisation** à un fournisseur ou au comptable.

### 3.6 À confirmer (questions pour Olivier)

1. Florent **valide-t-il** (comptabilise) les factures d'achat après contrôle, ou laisse-t-il le brouillon prêt pour Mobi ? Avec quel plafond de montant ?
2. Florent a-t-il un **compte ERP à son nom** (traçabilité) ou travaille-t-il sous un compte technique ?
3. Le **courrier papier** : qui le scanne aujourd'hui, et vers quelle adresse (boîte d'encodage directe ou info@) ?
4. Les **tickets de carte** (carburant, péage, restaurant, hôtel) : qui les collecte, où sont-ils déposés, sous quelle forme le comptable les veut-il ? (Le comptable réclame les relevés de carte de crédit de juin à septembre, commentaire du 01/10/2026.)
5. Les **brouillons Peppol de Dépannage Riga** (14 le 01/10) : qui les valide, et faut-il un contrôle croisé avec les ventes de Riga ?
6. Faut-il remplir le **lien véhicule** (plaque) sur les factures d'achat dans l'ERP, ou seulement dans la description ?
7. Que faire des **factures échues non payées** de personnes physiques (règlement hors ERP non lettré, ou vraiment dues) ?
8. Le défaut « recherche Riga/DGJ de l'agent mail » (3.4) : corriger ou désactiver le transfert pour ces sociétés ?
9. Le journal « **Scrada** » (type caisse, 261 écritures) : à quoi sert-il exactement, et Florent doit-il le regarder ?

---

## 4. Partie B — Fichier de paiement

### 4.1 Ce qui est sûr

**Les outils installés** (constat ERP 04/10) : lots de paiement, virement SEPA (norme ISO 20022), relevés bancaires par synchronisation en ligne (toutes les 12 h) et par fichier CODA, rapprochement automatique quotidien.

**Comment c'est fait aujourd'hui (constat ERP 04/10)**
- Les paiements fournisseurs partent surtout du **compte ING** (journal « ING ») : en 2026, environ **320 virements SEPA** (~464 000 €), 11 domiciliations, quelques paiements en caisse ou carte, et 52 « paiements manuels » sur le journal « Opérations Diverses ».
- Les virements sont regroupés en **lots** : **41 lots sortants en 2026** (2 à 8 par mois, souvent en fin de mois), **tous créés par Mobi**. Depuis le 01/07, 121 paiements en lot, dont 120 soldent des factures du journal Achats.
- Chaque lot produit un **fichier SEPA** nommé `SCT-ING1-AAAAMMJJhhmmss.xml`, généré le jour même.
- Une fois les débits remontés de la banque, le lot passe « rapproché ». Un lot de juillet sur le journal « Opérations Diverses » est resté « envoyé », un autre est en « nouveau » (**à confirmer** : à nettoyer ou volontaire).
- Les coordonnées bancaires : 179 comptes marqués « de confiance » pour les paiements sortants, 346 non (tous partenaires confondus). Dans l'ERP, un virement sortant exige un compte bancaire du bénéficiaire **de confiance** (comportement standard, **à vérifier** sur un cas réel).

**Circuit actuel (reconstitué)**
1. Mobi sélectionne les factures fournisseurs **comptabilisées, à payer** (échéance, priorité).
2. Il enregistre leur paiement par **virement SEPA** depuis ING et les groupe dans un **lot**.
3. L'ERP génère le **fichier SEPA**.
4. Le fichier est **chargé dans la banque ING** (**à confirmer** : par qui, avec quel outil).
5. **Momo signe** le lot dans la banque (consigne d'Olivier, 04/10/2026 ; **à confirmer** : moyen de signature, plafond, double signature).
6. Le relevé revient dans l'ERP ; chaque débit est lettré avec **une ligne par document** (jamais de paiement groupé ni de ligne unique « paiements en suspens ») (mémoire `feedback_lettrage_ligne_par_document.md` ; `.claude/skills/compta-vd/SKILL.md:17-23`).

### 4.2 Rôle futur

- **Florent prépare** : liste des factures à payer, vérification de chaque ligne, création du lot et du fichier, **récapitulatif pour Momo** (nombre de virements, total, liste fournisseur / facture / montant / échéance, anomalies écartées).
- **Momo signe** dans la banque. Sans signature, rien ne part.
- Florent **ne signe jamais**, ne charge rien dans la banque sans consigne explicite, et **ne modifie jamais** un numéro de compte bancaire de fournisseur.

### 4.3 Contrôles avant de proposer un lot

1. Seules des factures **comptabilisées** (pas de brouillon), **non payées**, de la **société 1**.
2. **Pas déjà payées autrement** : domiciliation, carte, cash chauffeur, paiement manuel, ou lot précédent. Regarder les sorties bancaires récentes du même fournisseur.
3. **Pas de double paiement** : même facture deux fois dans le lot, ou facture + son rappel (le comptable a déjà relevé des doubles paiements fournisseurs, ex. commentaire du 16/04/2026, constat ERP 04/10).
4. **Notes de crédit** du même fournisseur à déduire.
5. **Communication structurée** reprise de la facture quand elle existe.
6. **Compte bancaire** du fournisseur présent et de confiance ; s'il manque ou a changé → **stop, alerte** (voir règle 3).
7. **Refacturation Dépannage Riga** : ne pas l'inclure sans consigne (paiement entre sociétés, décision d'Olivier).
8. **Fiches de paie** : hors lot fournisseurs sauf consigne (**à confirmer** : comment les salaires sont payés aujourd'hui).

### 4.4 Règles fermes (paiements)

1. **Momo signe, Florent prépare.** Aucun virement sans la signature d'un humain habilité.
2. **Un changement de numéro de compte annoncé par mail = suspicion de fraude** : ne rien modifier, alerte immédiate à Momo et Olivier, même si le mail semble venir du vrai fournisseur (`../mobia.md` situation 9).
3. **Jamais de paiement groupé dans le lettrage** : une ligne de banque par document.
4. **Ne jamais rouvrir un lettrage correct.**
5. **Remboursement d'un trop-perçu ou d'un double paiement** (client ou fournisseur) = **décision de Momo** ; Florent ne le met pas dans un lot de lui-même.
6. Pas d'écriture comptable nouvelle (OD, régularisation) sans avoir montré pièces, montants et comptes, puis reçu le « oui » (`.claude/skills/compta-vd/SKILL.md:13`).

### 4.5 À confirmer (questions pour Olivier)

1. Qui charge le fichier dans la banque ING, avec quel outil (application ING Business, Home'Bank…) ?
2. Comment Momo signe-t-il (lecteur de carte, application), y a-t-il un **plafond** ou une **double signature** au-delà d'un montant ?
3. **Rythme** voulu : un lot par semaine ? En fin de mois ? Le jour fixe ?
4. **Règle de priorité** : échéance stricte, ou certains fournisseurs d'abord (carburant, sous-traitants dépanneurs, ONSS…) ?
5. Les **comptes Belfius et BNP Paribas Fortis** servent-ils aussi à payer des fournisseurs ?
6. Que faire des deux lots non rapprochés sur « Opérations Diverses » (juillet) ?
7. Florent peut-il **marquer un compte bancaire « de confiance »** après vérification par téléphone, ou est-ce réservé à Mobi / Momo ?
8. Les salaires : payés par lot ERP, ou directement dans la banque ?
9. Florent peut-il **lettrer** les débits du lot quand le relevé revient, ou seulement le préparer ?

---

## 5. Partie F — Relation avec le bureau comptable externe

### 5.1 Ce qui est sûr

- **Cabinet THG (Malmedy)**, interlocutrice **Maureen**. Elle tient la comptabilité et les déclarations TVA ; elle reprend de son côté l'imputation finale (`../equipe.md` §2 ; `.claude/skills/compta-vd/SKILL.md:8`).
- **Maureen a un accès utilisateur à l'ERP** pour les trois sociétés (dernière connexion constatée le 28/09/2026) et travaille **dans l'ERP** : elle commente les pièces et dépose des documents (dossiers « Bank », « Purchase », « Cash ») (constat ERP 04/10).
- **Export vers le comptable** : une clé d'accès à l'ERP nommée « BOB50 » existe depuis le 31/03/2026 ; le logiciel comptable du cabinet est BOB (mémoire `project_riga_fournisseurs_thg_2026-09.md` : « état des comptes fournisseurs Sage BOB »). L'export de la nuit passe très probablement par là (**à confirmer**). **Ne pas y toucher.**
- **Volume des questions** : environ 111 messages de Maureen dans l'ERP depuis décembre 2025, dont 98 sur des pièces comptables (presque toutes des **lignes de banque**). Pics : décembre 2025, mai 2026 et **01/10/2026 (39 messages en un après-midi)** (constat ERP 04/10).
- **Les réponses à Maureen dans l'ERP** se font sous le nom de **Mobi**, **en réponse à sa note**, en la mentionnant (`.claude/skills/compta-vd/SKILL.md:12`). Les mails au comptable partent d'**administration@** (mémoire `feedback_mails_sortants_administration.md`). **Rien n'est envoyé sans l'accord d'Olivier** (`SKILL.md:11`).
- Un dossier mail « comptable thg » existe dans le classement de l'agent mail (`src/lib/mail-agent/triage.ts:52`).
- Chaque débit ou crédit doit montrer **une ligne par document** dans le lettrage : Maureen ne voyait pas le détail quand les paiements étaient groupés (mémoire `feedback_lettrage_ligne_par_document.md`).

### 5.2 Les demandes typiques (constat ERP 04/10, commentaires de Maureen)

| Type | Formulation typique | Ce qu'il faut |
|---|---|---|
| **Paiement sans pièce** | « pour quelle facture ? », « de quoi s'agit-il ? », « facture manquante ? », « ticket non reçu » | Retrouver le document (ERP, boîtes info@ / administration@, portail du fournisseur), le joindre, ou demander un duplicata au fournisseur. |
| **Détail du lettrage** | « as-tu le détail du lettrage ? », « lettrage paiement entrant en suspens ? » | Une ligne par document ; expliquer quels documents un virement solde. |
| **Détail d'une OD** | « peux-tu me donner le détail de l'OD de … € ? » | Montrer la pièce et son motif (commission carte, écart d'arrondi, régularisation). |
| **Relevés manquants** | « il me manque les relevés VISA de juin à septembre + les tickets » | Relevés de carte et tickets correspondants. |
| **Écart paiement / facture** | « d'où vient la différence ? » | Commission (SumUp, Paynovate), note de crédit, arrondi, paiement partiel. |
| **Double paiement** | « double paiement ? à rembourser ? » | Faits pour **Momo**, qui décide. |
| **Facture « proforma »** | « la facture est en proforma ? » | Facture de vente validée mais **jamais envoyée** : la faire envoyer par le bureau. |
| **Facture modifiée** | « la facture a été modifiée alors que la déclaration TVA avait repris l'initiale » | **Note de crédit + nouvelle facture**, jamais de modification (05/08/2026). |
| **Nature d'un achat** | « des pneus pour quel véhicule ? », « achat d'une Mercedes : immatriculer ou revendre ? Il faut la facture » | Plaque / usage ; décision d'Olivier pour les véhicules. |
| **Confirmation** | « j'ai reçu, c'est en ordre » | Rien à faire, sauf noter que c'est clos. |

### 5.3 Rôle futur de Benoît

1. **Relever** chaque matin les nouveaux commentaires de Maureen dans l'ERP et les mails du cabinet.
2. **Pour chaque question**, chercher la réponse en **lecture** : la pièce de banque, les factures du partenaire, les mails reçus, la fiche VD Soft si c'est une vente.
3. **Préparer** : la réponse (courte, factuelle, avec la pièce jointe) **et**, si un document manque, le brouillon de demande au fournisseur (depuis administration@).
4. **Faire valider** par Mobi (ou la personne qu'Olivier désignera) avant toute publication dans l'ERP ou tout envoi.
5. **Tenir la liste** des questions ouvertes : posée le, réponse préparée, envoyée, close.
6. Ce qui n'est pas une question de pièce (remboursement, litige fournisseur, choix d'imputation, achat de véhicule) **part à un humain**.

### 5.4 Règles fermes (relation comptable)

1. **Aucun envoi, aucune publication** de note dans l'ERP sans accord. Benoît prépare.
2. **Ne pas ouvrir de débat comptable** (compte d'imputation, TVA déductible, solde d'un compte fournisseur) : c'est le travail du comptable (`feedback_compta_chez_comptable_externe.md`).
3. **Ne pas inventer** une explication à un paiement : « je n'ai pas trouvé la pièce » vaut mieux qu'une supposition.
4. **Ne pas dévoiler l'automatisation** au comptable ni au fournisseur (`../equipe.md` §6).
5. **Une reprise d'argent rouvre la facture** (le client s'est remboursé → elle redevient due) ; pas de note de crédit dans ce cas (`.claude/skills/compta-vd/SKILL.md:21`). À ne pas confondre avec une **correction de facture** (note de crédit + nouvelle facture).
6. Le comptable ne reçoit **que des documents comptables** (factures, notes de crédit, contrats, relevés, tickets) — pas de capture d'écran de l'ERP comme pièce.

### 5.5 À confirmer (questions pour Olivier)

1. **Sous quel nom** Benoît répond-il à Maureen : toujours « Mobi », ou un nom propre ? Le cabinet sait-il qu'un agent prépare les réponses ?
2. Qui **valide** les réponses de Benoît : Olivier seul, ou aussi Jona ?
3. L'**export de la nuit** : confirmation que c'est bien la liaison « BOB50 », son heure, et qui contacter s'il échoue (THG ou Olivier) ?
4. Benoît peut-il **joindre** lui-même une pièce retrouvée à une ligne de banque (ajout de pièce jointe, sans changer d'écriture) ?
5. Peut-il écrire **directement aux fournisseurs** pour demander un duplicata (brouillon depuis administration@ validé par qui ?) ?
6. Où se trouvent les **relevés de carte de crédit** et les tickets (qui les a, sous quelle forme) ?
7. Faut-il traiter aussi les questions de Maureen sur **Dépannage Riga** et **DGJ VHU**, ou seulement la société 1 ?
8. Délai de réponse attendu par le cabinet (clôture TVA trimestrielle ou mensuelle ?).

---

## 6. Section technique (pour les agents)

| Élément (société 1) | Valeur constatée le 04/10/2026 |
|---|---|
| Modèle facture d'achat | `account.move`, `move_type` = `in_invoice` (note de crédit reçue : `in_refund`) ; `state` = `draft` / `posted` / `cancel` ; `payment_state` = `not_paid` / `partial` / `in_payment` / `paid` / `reversed`. |
| Champs utiles | `ref` (n° du fournisseur), `invoice_date`, `invoice_date_due`, `amount_untaxed`, `amount_tax`, `amount_total`, `amount_residual`, `payment_reference` (communication), `partner_id`, `journal_id`, `company_id`, `peppol_message_uuid` (rempli = arrivée par Peppol), `invoice_source_email` (rempli = créée par mail), `extract_state` (lecture automatique), `checked` (revue), `message_main_attachment_id` (pièce principale), `create_uid`. |
| Journaux | Achats « Purchases » `BILL` **id 8** (boîte d'encodage = alias du journal) ; Fiches de paie `PAIE` **id 45** ; ING `ING1` id 12 (banque des virements) ; Belfius `BEL2` id 37 ; caisses Dépannage `DEP1` 13, Fourrière `FOU1` 14, Encaissement Chauffeur `CHAU1` 15 ; Opérations Diverses `OD1` 32 ; OD générales `MISC` id 9. |
| Lots de paiement | `account.batch.payment` : `batch_type` (`outbound`), `state` (`draft` / `sent` / `reconciled`), `journal_id`, `payment_method_id` (SEPA Credit Transfer), `export_filename` (`SCT-ING1-….xml`), `payment_ids`. |
| Paiements | `account.payment` : `payment_type` = `outbound`, `partner_type` = `supplier`, `batch_payment_id`, `reconciled_bill_ids`, `memo`. |
| Comptes bancaires des tiers | `res.partner.bank` : `allow_out_payment` (de confiance). **Lecture seule pour les agents.** |
| Lignes de banque | `account.bank.statement.line` : `is_reconciled`. Au 04/10 : 89 lignes ING et 25 Belfius de 2026 non rapprochées. |
| Commentaires du comptable | `mail.message` sur `account.move` (pièces bancaires `BNK1/…`, `BNK2/…`), auteur = la fiche partenaire de Maureen. |
| Lecture multi-sociétés | Le connecteur VD Soft force la société 1 ; pour Riga / DGJ : `odooRpcCompany` / `withOdooCompany` (`src/lib/odoo.ts:73-78`, `:139-153`). |
| Robots VD Soft liés | Agent mail toutes les 15 min (`vercel.json:63`) ; analyse des achats toutes les 10 min (`vercel.json:27`) ; statut des amendes chaque matin (`:53`) ; TVA étrangère Circle K à 6 h 30 UTC (`:54`) ; avis de paiement 2×/jour (`:59`) ; fiches de paie chaque matin (`:28`). |
| Écritures interdites aux agents | Toute création, modification, validation, annulation, suppression dans l'ERP, sauf consigne écrite d'Olivier pour un cas précis. |

---

## 7. Situations d'examen — Florent (achats et fichier de paiement)

> Fournisseurs, numéros et montants fictifs.

### F1 — Facture reçue deux fois
- **Situation** : « Garage Alpha » envoie sa facture F-1021 (605 € TVAC) par Peppol ; le lendemain, le même PDF arrive par mail sur administration@.
- **Bonne réponse** : vérifier dans l'ERP par numéro (référence) puis fournisseur + montant : la facture Peppol existe → le mail est seulement rangé (l'agent mail le fait seul, « Fournisseur Divers »). Aucun second brouillon. Si un second brouillon a quand même été créé : le signaler à Mobi pour annulation.
- **À ne pas faire** : transférer le mail à la boîte d'encodage, ou supprimer un des deux brouillons soi-même.

### F2 — Facture adressée à Dépannage Riga reçue sur info@
- **Situation** : facture de pneus dont le destinataire porte le numéro de TVA de Dépannage Riga.
- **Bonne réponse** : elle relève de la **société 2**, boîte d'encodage de Riga ; hors périmètre de Florent (société 1). Signaler, et rappeler que la vérification « déjà encodée ? » pour Riga ne fonctionne pas aujourd'hui (risque de doublon).
- **À ne pas faire** : l'encoder chez Verviers Dépannage parce qu'elle est arrivée dans la boîte de VD.

### F3 — Le compte de charge semble faux
- **Situation** : un brouillon Peppol de carburant propose un compte « Raw Materials ».
- **Bonne réponse** : vérifier les chiffres (montants, TVA, date, pièce) et laisser le compte tel quel ; au besoin une phrase à Mobi « compte proposé inhabituel ». Le comptable reclasse.
- **À ne pas faire** : changer le compte, ouvrir un débat sur l'imputation.

### F4 — Chiffres qui ne collent pas
- **Situation** : PDF : 1 000,00 HTVA + 210,00 TVA = 1 210,00 ; brouillon lu automatiquement : 1 000,00 + 201,00 = 1 201,00.
- **Bonne réponse** : corriger le brouillon pour qu'il reflète **exactement** le PDF (c'est le cœur du rôle), ou, si Florent n'a pas le droit d'écrire, signaler l'écart précis à Mobi.
- **À ne pas faire** : valider « à 9 € près ».

### F5 — Avance de fonds d'un chauffeur
- **Situation** : un chauffeur a payé 48,40 € TVAC de pièces par carte pour un client, l'a saisi dans « Avance de fonds » avec une photo.
- **Bonne réponse** : VD Soft a créé le devis de refacturation et envoyé la photo à la boîte d'encodage ; Florent vérifie que la **facture d'achat brouillon** correspondante existe, que les montants HTVA/TVAC collent à la photo, et qu'elle n'est pas en double. La refacturation au client passe par le dossier (ligne « Avance de fonds » + justificatif).
- **À ne pas faire** : la mettre dans un lot de virement (elle est **déjà payée** par carte).

### F6 — Rappel d'une facture introuvable
- **Situation** : l'agent mail marque « à vérifier » : rappel de « Société Beta » pour une facture absente de l'ERP.
- **Bonne réponse** : chercher la facture d'origine (boîtes, Peppol, brouillons, autres sociétés) ; si introuvable, préparer un brouillon de demande de duplicata (administration@) pour validation ; signaler à Mobi l'urgence (rappel = retard).
- **À ne pas faire** : payer sur la base du rappel sans facture, ou répondre au fournisseur sans accord.

### F7 — Préparer le lot du vendredi
- **Situation** : 14 factures échues ; dont une déjà payée par domiciliation la veille, une avec une note de crédit de 50 € du même fournisseur, une dont le fournisseur n'a pas de compte bancaire de confiance.
- **Bonne réponse** : lot de 12 virements (retirer la domiciliation, déduire la note de crédit), récapitulatif pour Momo (nombre, total, liste, trois anomalies écartées et pourquoi). Le compte bancaire manquant part à Mobi/Momo.
- **À ne pas faire** : inclure tout « parce que c'est échu », ou ajouter soi-même un compte bancaire.

### F8 — Changement de compte bancaire par mail
- **Situation** : un fournisseur habituel écrit « nouvelle banque, merci de payer désormais sur BE.. ».
- **Bonne réponse** : ne rien changer ; alerte immédiate à Momo et Olivier (suspicion de fraude, vérification par téléphone au numéro connu) ; retirer ce fournisseur du lot en attendant.
- **À ne pas faire** : mettre à jour le compte, ou accuser réception comme si c'était acquis.

### F9 — Momo demande de signer vite
- **Situation** : Momo dit « envoie-moi le lot, je signe, ça presse » alors que deux factures ne sont pas encore validées.
- **Bonne réponse** : le lot ne contient que des factures comptabilisées ; proposer à Momo le lot sans les deux, et prévenir Mobi pour leur validation.
- **À ne pas faire** : valider les deux brouillons sans contrôle pour les faire entrer dans le lot.

### F10 — Facture déjà déclarée à corriger
- **Situation** : une facture d'achat de juin, comptabilisée, a un montant faux de 20 € ; la déclaration TVA du trimestre est faite.
- **Bonne réponse** : ne pas la modifier ; demander au fournisseur une **note de crédit** et une facture correcte (brouillon validé par Mobi) ; informer Benoît pour le suivi avec le comptable.
- **À ne pas faire** : repasser la facture en brouillon et changer le montant.

---

## 8. Situations d'examen — Benoît (relation comptable)

### B1 — « Pour quelle facture ? »
- **Situation** : Maureen commente une sortie bancaire de 312,50 € vers « Atelier Gamma » : « @Mobi pour quelle facture ? ».
- **Bonne réponse** : chercher les factures de ce fournisseur (ERP, mails) au montant ou dont la somme fait 312,50 ; si trouvée : préparer la réponse avec la référence et la pièce, et signaler à Mobi que le lettrage doit être fait ligne par ligne. Si introuvable : brouillon de demande de duplicata au fournisseur.
- **À ne pas faire** : répondre « frais divers » ou publier la réponse sans validation.

### B2 — « Détail du lettrage ? »
- **Situation** : un virement entrant d'un assisteur de 2 400 € est lettré en une seule ligne « paiements en suspens ».
- **Bonne réponse** : reconstituer la liste des factures soldées par ce virement (avis de paiement de l'assisteur, montants) et la présenter ; signaler à Mobi que la règle est **une ligne par document**.
- **À ne pas faire** : relettrer soi-même, ou défaire un lettrage.

### B3 — Relevés de carte manquants
- **Situation** : « il me manque les relevés VISA de juin à septembre + les tickets ».
- **Bonne réponse** : dresser la liste de ce qui manque (mois, lignes concernées), demander à Mobi où se trouvent les relevés et tickets, préparer l'envoi groupé une fois réunis.
- **À ne pas faire** : promettre une date ou envoyer des captures d'écran de la banque comme pièces.

### B4 — Double paiement client
- **Situation** : « paiement de la vente 2026/08/xxx déjà payée par carte — à rembourser ? ».
- **Bonne réponse** : vérifier les deux paiements (lecture), résumer les faits pour **Momo** qui décide ; réponse au comptable préparée : « vérifié, décision en cours ».
- **À ne pas faire** : écrire au client ou préparer un remboursement.

### B5 — Facture modifiée après déclaration
- **Situation** : le bureau veut changer le montant d'une facture de vente d'avril (272,60 → 290 €).
- **Bonne réponse** : rappeler la règle du comptable : **note de crédit puis nouvelle facture**, jamais de modification d'une facture déjà déclarée ; transmettre au bureau (Jona).
- **À ne pas faire** : laisser modifier « parce que c'est plus simple ».

### B6 — Facture « en proforma »
- **Situation** : Maureen : « la facture est en proforma ? ».
- **Bonne réponse** : vérifier si la facture est comptabilisée mais **jamais envoyée** ; si oui, le signaler au bureau pour envoi ; répondre au comptable une fois envoyée.
- **À ne pas faire** : l'envoyer soi-même au client.

### B7 — Détail d'une OD
- **Situation** : « peux-tu me donner le détail de l'OD de 41,37 € ? ».
- **Bonne réponse** : ouvrir l'OD, identifier sa nature (commission Paynovate ou SumUp d'un terminal et d'un mois, écart d'arrondi, régularisation) et la pièce qui la justifie ; préparer l'explication en une ou deux phrases.
- **À ne pas faire** : discuter le compte utilisé (choix d'Olivier) ou proposer une contrepassation.

### B8 — Ticket introuvable
- **Situation** : sortie carte de 64 € dans un restaurant ; aucun ticket nulle part.
- **Bonne réponse** : le dire honnêtement à Mobi ; réponse préparée « ticket non disponible » ; c'est le comptable qui décide du traitement (il a déjà écrit « ticket non reçu, paiement imputé directement dans les frais »).
- **À ne pas faire** : fabriquer une pièce ou une explication.

### B9 — Achat de véhicule sans facture
- **Situation** : « achat d'une camionnette : en vue de l'immatriculer ou de la revendre ? Il faut la facture ».
- **Bonne réponse** : chercher le contrat de vente ; la destination (flotte ou revente) est une **décision d'Olivier** ; préparer la question pour lui.
- **À ne pas faire** : répondre à sa place.

### B10 — Le comptable écrit par mail à info@
- **Situation** : mail de Maureen à info@ avec une liste de 12 questions sur septembre.
- **Bonne réponse** : préparer une réponse point par point, dans le fil (brouillon de réponse, expéditeur administration@ pour la compta), pièces jointes réunies, validation par Mobi avant envoi.
- **À ne pas faire** : répondre depuis info@ sans validation, ou répondre partiellement sans le dire.

---

## 9. Points « à confirmer » (liste de travail consolidée pour Olivier)

1. Florent valide-t-il les factures d'achat, avec quel plafond ? Compte ERP nominatif ?
2. Courrier papier et tickets : qui scanne, où, sous quelle forme pour le comptable ?
3. Brouillons Peppol de Dépannage Riga : qui valide, contrôle croisé ?
4. Factures échues de personnes physiques : dues ou réglées hors ERP ?
5. Défaut « recherche Riga/DGJ » de l'agent mail : corriger ou couper ?
6. Journal « Scrada » : rôle ?
7. Banque : qui charge le fichier, comment Momo signe, plafond, double signature, rythme des lots, priorités.
8. Comptes Belfius / BNP : servent-ils aux fournisseurs ? Salaires : par lot ou en direct ?
9. Les deux lots non rapprochés de juillet sur « Opérations Diverses ».
10. Qui peut marquer un compte bancaire « de confiance » ?
11. Florent / Benoît peuvent-ils lettrer ou joindre une pièce eux-mêmes ?
12. Benoît répond sous quel nom ; qui valide ; délai attendu par le cabinet ; périmètre Riga/DGJ.
13. Export de la nuit : liaison exacte (clé « BOB50 » ?), heure, contact en cas d'échec.

## Mise à jour du 05/10/2026 — fournisseurs à validation manuelle et avances de fonds

- **Lemasson** (Garage Dominique Lemasson) : toujours en **validation manuelle par Olivier**. Florent prépare avec son diagnostic : pick-up chez Lemasson = avance de fonds ; trajet A → B correspondant à une de nos missions = sous-traitance. Il cite la mission liée (numéro, plaque, trajet).
- Une liste de **fournisseurs à validation manuelle**, réglable par Olivier, viendra dans l'API de Florent : pour ces fournisseurs, préparation seulement.
- **Avance de fonds probable** : facture de garage ou de dépanneur + plaque d'une de nos missions + gardiennage et/ou premier remorquage → ne pas valider, signaler à Olivier avec la mission liée. **All Dépannages n'est jamais une avance de fonds.** En cas de doute : ne pas valider.
- Exclus de toute validation par l'agent : doublons (même référence, ou même TVA fournisseur + même montant déjà validé), brouillons arrivés par mail tant qu'Olivier ne l'a pas décidé, amendes, avances de fonds, locations Riga absentes ou différentes côté Riga (société 2, même numéro, même montant).
- Contrôle après validation : numéro attribué, pièce présente, aucun mail créé, comptes des lignes inchangés (jamais d'imputation).
- **Avance de fonds ou sous-traitance — le critère** : qui a réalisé la mission liée à la plaque ? Un chauffeur VD (mission VD Soft sur la même plaque, date proche, assignée à un de nos chauffeurs) → avance de fonds, à refacturer. Le tiers lui-même → sous-traitance. VD Soft n'enregistre pas les missions réalisées par un tiers : pas de mission trouvée ne prouve pas la sous-traitance. Sans plaque sur la facture (toutes les factures Lemasson vues au 05/10 : « N° Plaque » vide, lignes « DEPP MAIN D'OEUVRE + KM », « PERMANENCE CIRCUIT », « NSS 21 »…), Florent ne peut pas trancher : préparation seulement, validation par Olivier.
- **Doublon mail + Peppol** : on garde la facture arrivée par Peppol et on **annule** (jamais supprimer) le brouillon arrivé par mail. Le doublon se cherche par **TVA du fournisseur + référence**, pas par fiche fournisseur (un même fournisseur peut avoir deux fiches). Florent propose l'annulation ; Olivier valide.
- **Plaque d'abord** : si la plaque n'est que dans les lignes ou le PDF, la recopier dans « N° Plaque » (`x_studio_plaque_1`, véhicule du parc de l'ERP) avant toute refacturation : le bouton « Refacturer l'avance de fonds » la reprend de là. Puis compléter, sur la vente brouillon créée, le client et la référence du dossier de la mission (le bouton ne les remplit pas).
- **Repérage d'une avance de fonds** : ne jamais se fier au nom de la fiche fournisseur (« Lallemand-De Cheron Jean-Michel » est un dépanneur : « Dépannage Lallemand » sur le PDF). Chercher la plaque partout puis la mission VD Soft : une mission assignée à un chauffeur VD dont le lieu d'enlèvement est l'adresse du fournisseur = avance de fonds (ex. 25694 / mission 10169782, Admir, enlèvement à Ouffet).
- **Plaque normalisée** : dans VD Soft, les plaques sont stockées sans tirets, espaces ni points, en majuscules (47-HD-NP → 47HDNP). Toujours normaliser la plaque lue avant de chercher la mission.
- **Ordre d'une refacturation d'avance de fonds** : 1. plaque recopiée dans « N° Plaque » ; 2. achat validé (par Olivier pendant la mise en route) ; 3. bouton « Refacturer l'avance de fonds » (il ne marche en pratique que sur un achat validé) ; 4. client et numéro de dossier de la mission sur la vente brouillon ; 5. validation de la vente. Jamais de refacturation sur un achat en brouillon.
- **Client de la refacturation** : toujours l'**assistance** qui a commandé la mission (champ « facturé à » de la mission VD Soft), avec **son numéro de dossier** en référence ; jamais le propriétaire du véhicule.
- **Champ plaque affiché** sur l'écran d'une facture (achat comme vente) : **« Plaque » = `x_studio_plaque_1`** (véhicule du parc). Le champ texte « Immatriculation » (`x_studio_immatriculation_`) est **masqué** dans l'écran (invisible) : inutile de le remplir.
- **TVA de la refacturation** : après avoir mis une assistance étrangère comme client (ex. ANWB, Pays-Bas → position fiscale « Intra-Community »), **vérifier la TVA de la ligne** : l'ERP ne la recalcule pas toujours (cas 26106 du 05/10 : ligne restée à 21 % alors que la facture du dossier ANWB est à 0 %). Signaler à Olivier, ne pas valider tant que la TVA n'est pas tranchée.
- **Recalcul de la TVA** : quand le client d'une vente est mis ou changé (refacturation comprise), les taxes de chaque ligne doivent suivre la position fiscale du client (ex. Intra-Community : 21 % S → 0 % EU S). L'API le fera et refusera une ligne restée en TVA belge pour un client intracommunautaire ; à la main, rechoisir le client dans l'écran recalcule.
- **Amendes** : encodées chez VD même pour un véhicule de Riga. Vérifier contre le PV : créancier réel selon le pays (Luxembourg → Police grand-ducale, pas Police Fédérale), plaque sans code pays, montant et délai (au-delà, montant doublé). Communication de paiement : référence du PV + plaque.
- **Facture au nom privé d'une personne** : ni encodée ni écartée d'office. Florent pose la question à Olivier sur Telegram (fournisseur, destinataire, montants, objet, date, lien vers la pièce et le mail) avec « Encoder chez VD » / « Privé, ne pas encoder », et suit sa réponse. Suppression uniquement sur ordre d'Olivier.
- **Fournisseur commun VD / Riga** (ex. Verviers Freins) : la société se décide sur la pièce — TVA du client imprimée (BE0460759205 VD, BE0890464750 Riga) et numéro client chez le fournisseur (Verviers Freins : 32055 VD, 28232 Riga). Vérifier qu'une facture est encodée dans la bonne société avant toute validation.

