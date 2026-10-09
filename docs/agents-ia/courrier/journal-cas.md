# Journal des cas de courrier — décisions de Mobi

Traitement des boîtes dossier par dossier avec Mobi (à partir du 08/10/2026). Chaque cas : le mail, ce qu'on
vérifie, la décision, la règle à retenir pour les agents. Source de formation des agents (relayée à Hyper Projet).

## Boîte de réception d'administration@

### 1. Client qui conteste une relance alors que les factures sont déjà créditées
- Mail : Ville de Verviers (27/07) répond à la relance REL-20260727-L1-642 (400 €) : « ce ne sont pas nos véhicules ».
- Vérifié : les 2 factures (2026/04/291 et 2026/06/151) ont été annulées par notes de crédit le 23/09 ; le
  propriétaire de 2HNC434 a été facturé et a payé ; celui de 2GKD778 n'a jamais été facturé.
- Décision : **classer** (clients divers), sans réponse.
- Règle : si les factures contestées sont déjà créditées et que rien n'est dû, on classe. Vérifier quand même que le
  vrai débiteur a été facturé et le signaler.

### 2. Huissier pour une copropriété : véhicule enlevé non réclamé, cession proposée
- Mail : Étude Bordet (03/09, urgent) pour la copropriété Espace 58 (Andrimont) : Opel Corsa enlevée le 01/07,
  non réclamée ; cession du véhicule à VD pour solde de tout compte.
- Vérifié : la fiche était encodée « saisie judiciaire police » avec l'huissier comme agent, et un état de frais
  avait été envoyé aux Frais de justice.
- Décision : **accepter la cession** pour solde de tout compte (réponse depuis administration@ : acte de cession
  signé, certificat d'immatriculation et clés) ; **corriger la fiche** (source Privé, client = la copropriété via
  l'huissier) ; **annuler l'état de frais** auprès des Frais de justice (depuis fourriere@, dans le fil de l'envoi) ;
  classer.
- Règles : une expulsion demandée par un huissier ou un particulier n'est jamais une saisie judiciaire, et ne part
  jamais aux Frais de justice ni au Parquet. Un huissier attend une réponse : ne jamais laisser sans suite.

### 3. Sinistre : un assureur nous réclame des dommages causés par VD
- Mail : Allianz (15/09), BMW X7 2HCH844 (sinistre du 12/09/2025) : « vos intentions de règlement ». Réclame 7 217,42 €
  alors que le devis validé était de 3 873,31 € HTVA ; écart jamais expliqué.
- Décision : **transférer à Momo** (momo@verviersdepannage.be) avec l'explication, l'historique complet et les pièces
  (devis validé, facture, expertise) ; c'est Momo qui assure le suivi. Classer.
- Règle : les sinistres et réclamations de responsabilité contre VD vont à Momo, avec un résumé daté du fil, les
  montants et les pièces clés. L'agent ne paie pas et ne répond pas à l'assureur.

### 4. Client qui pose une question sur une facture déjà payée, véhicule parti
- Mail : ASD Verviers (23/09) sur la facture 2026/09/469 (220 €, gardiennage) : « le montant n'est pas plus élevé ? l'assurance a pris une partie ? »
- Vérifié : intervention facturée à Ethias (2026/09/470), part client (gardiennage) déjà payée, véhicule reparti.
- Décision : **classer sans répondre**.
- Règle : facture du client payée et véhicule sorti = dossier clos ; une question de curiosité sur le montant ne demande pas de réponse.

### 5. Assistance qui répond à une relance avec un commentaire par facture (factures d'avant 2026)
- Mail : IMA pour Ethias (25/09), relance REL-20260923-L1-16 (6 752,92 €, 9 factures de 2022 à 2025) : tableau commenté.
- Décisions de Mobi, par type de réponse :
  - « payée le … dans un virement groupé » (20236218) : **solder par opération diverse** (compte d'attente), à
    vérifier plus tard sur l'historique client de la comptable (et dans Billit pour le mouvement).
  - « doublon, déjà payée via … » (20250122, 20254657) : **note de crédit totale**, envoyée par Peppol.
  - « facture pas reçue » (20250706, 20254622) : **renvoyer par Peppol**.
  - contestation de tarif (20234251, 1,50 €/km au lieu de 1,25 €) : **créditer et refacturer au tarif réclamé**
    (2 521 km × 1,25 €, même dossier B3E279702AK) → 2026/10/174.
  - contestations de fond (20242151 complément incompris, 20242080 « demande directe, pas appel police ») :
    **crédit total**.
  - puis classer.
- Règles : une réponse d'assistance à une relance se traite ligne par ligne selon son motif (payée → lettrer ou OD
  d'attente ; doublon → NC totale ; non reçue → renvoi ; tarif → NC + refacturation au bon tarif ; contestation →
  décision de Mobi). Les NC et factures partent par Peppol si le client y est inscrit. La règle « rien avant 2026 »
  ne s'oppose pas à solder une facture d'avant 2026 encore relancée.

### 6. Propriétaire étranger qui abandonne son véhicule, déjà traité par un collègue
- Mail : Peter Valen (27/09), VW Jetta NL 14-HKB-1 accidentée : abandon, demande de renvoi des plaques.
- Vérifié : Jona avait tout fait (document d'abandon, plaques postées, frais remboursés, facture payée) ; mais le
  gardiennage était resté ouvert et le véhicule n'était pas en circuit épave.
- Décision : **classer**, **fermer le gardiennage à la date de l'abandon**, **mettre en circuit épave** (lot « pour
  pièces » en brouillon dans les Ventes : VD-2026-004), **informer Jona** par mail qu'on a clôturé son dossier.
- Règles : un abandon volontaire enregistré = gardiennage fermé à cette date et véhicule mis en circuit épave
  (Ventes, origine abandon). Quand on clôt un dossier qu'un collègue suivait, on le prévient.

### 7. Assistance qui renvoie le tableau de relance commenté (« encodée », « payée le … »)
- Mails : AXA (28/09), relances L1-35 et L1-36.
- Vérifié : tout ce qu'AXA dit « encodé le 28/09 » a été payé le 30/09 ; la seule facture ouverte (2026/01/289) avait
  été payée le 20/01 NETTE des deux notes de crédit citées dans la communication du virement, mais les NC n'avaient
  pas été lettrées.
- Décision : **lettrer les 2 NC avec la facture** (tout soldé), **classer sans répondre**.
- Règles : relire la communication du virement — une assistance déduit souvent ses NC du paiement ; le lettrage
  doit alors réunir facture + NC + paiement. Un tableau de relance commenté qui ne demande rien = classer.

### 8. Client qui demande nos coordonnées bancaires pour payer
- Mail : Mme Frédérich (01/10), relance L1-1177 (facture 2026/03/016, 120 €) : « envoyez-moi vos coordonnées ».
- Décision : **répondre tout de suite** dans le fil (compte, communication = n° de facture, facture en PDF jointe),
  puis classer.
- Règle : un client qui veut payer reçoit la réponse sans attendre (IBAN, communication = n° de facture, PDF joint).
  Geste mécanique, l'agent mail peut le faire seul après avoir vérifié que la facture est toujours ouverte.

### 9. Client qui signale avoir déjà payé une facture reçue après coup
- Mail : RMA Track Days (01/10, en anglais) : facture Circuit 2026/09/638 (1 573 €) envoyée après leur paiement du 12/08.
- Vérifié : paiement Belfius du 12/08 enregistré au compte du client mais jamais lettré (communication avec un
  numéro de commande différent d'un chiffre : S05313 au lieu de S05314).
- Décision : **lettrer** le paiement avec la facture, **répondre** (dans la langue du client) que tout est en ordre,
  que c'est un plaisir de travailler pour eux et merci de leur confiance ; classer.
- Règles : « déjà payé » → chercher le paiement au compte du client (paiement non lettré, référence approchante) et
  lettrer. Un client du Circuit qui remercie reçoit une réponse cordiale, dans sa langue.

### 10. Huissier : enlèvement pour une saisie, puis « solde reçu, restituez au débiteur »
- Mails : Resalex (23/09 et 01/10), dossier SPW54750 (Région wallonne c/ Schroeder), KIA 2BGB598.
- Vérifié : fiche encodée « saisie police » avec dossier destiné au Parquet ; véhicule toujours au parc.
- Décision : **corriger la fiche** (source Privé, client l'huissier, dossier de saisie clos, rien au Parquet) ;
  **facturer l'huissier** : enlèvement 200 € TVAC (165,29 € HTVA) + gardiennage jusqu'à la date de son courrier
  (8 nuits × 20 € HTVA) → 2026/10/175 ; **restitution autorisée** au débiteur ; **le gardiennage continue** et sera
  facturé, à partir du lendemain du courrier, à la personne qui récupère le véhicule ; classer les deux mails.
- Règles : une saisie d'huissier n'est jamais une saisie police. L'huissier paie jusqu'à la date qu'il indique ; au-delà,
  c'est la personne qui récupère le véhicule (sans refacturer l'enlèvement).
- Suite (08/10) : Mobi ne voit plus la Kia au parc. Question envoyée à Jona (l'a-t-il rendue ?). **Si oui (réponse
  attendue le 09/10) : annuler la fiche de gardiennage à charge du client** (volet 10160122, gardiennage à partir du 02/10).

### 11. Formulaire DigiForm (transport de déchets / épave)
- Mail : DigiForm (01/10), DGF-511240 : transport définitif d'une Toyota Yaris (épave) par Autobedrijf Hubert.
- Décision : **tous les mails DigiForm vont dans « Fournisseur Divers »** (règle fixe de l'agent mail, info@ et
  administration@ : no-reply@digiform.be → Fournisseur Divers).
- Règle : un avis DigiForm est une confirmation administrative, pas une demande ; classer sans action.

### 12. Assistance : « facture au mauvais nom » + « on ne retrouve pas le dossier »
- Mails : Allianz (02/10, NL puis FR), relance L1-126 : 2026/01/536 doit être au nom d'AWP P&C SA ; 2026/02/081 sans
  dossier retrouvable.
- Vérifié : 2026/01/536 adressée à AP Solutions ; 2026/02/081 n'était pas une vraie facture mais une copie créée
  automatiquement par l'ERP à la réception d'un document Peppol (doublon de notre 20256440, déjà payée).
- Décision : 2026/01/536 → **NC + refacturation à AWP P&C S.A. – Belgian Branch** (2026/10/176, Peppol) ;
  2026/02/081 → **NC totale** (doublon) ; **répondre en néerlandais** ce qui a été fait ; classer.
- Règles : « mauvais destinataire » = NC + même facture au bon nom, même référence et même véhicule. Une facture sans
  dossier peut être un doublon créé par une réception Peppol : comparer avec nos factures de même montant et même
  client. Répondre dans la langue de l'interlocuteur quand Mobi le demande, même pour un client Peppol.

### 13. Parquet : « je ne retrouve pas le dossier, pas de réquisitoire »
- Mail : Parquet de Huy, Mme Cornil (02/10) : réquisitoires demandés pour EDF-2026-0017, 0033, 0034.
- Vérifié : aucun des 3 dossiers n'avait de réquisitoire valable (capture de mail retirée) et aucune demande n'avait
  été faite à la police ; pour la BMW X5 (EDF-0034), levée d'immobilisation reçue le 16/06 et frais payés le jour même
  par le propriétaire (2026/06/363) — la fiche était restée « au parc » et l'état de frais était parti quand même.
- Décision : **un mail par agent de police** (depuis fourriere@) pour demander le réquisitoire (Thyssens : Kangoo ;
  Lemaire : moto) ; **EDF-0034 annulé**, fiche sortie au 16/06 ; **réponse au Parquet** (erreur sur 0034, réquisitoires
  demandés pour les deux autres) ; classer. À la réception des réquisitoires : les transmettre à Mme Cornil.
- Règles : un réquisitoire se demande à l'agent de police qui a fait la saisie, un mail par agent, jamais au Parquet.
  Avant tout état de frais : vérifier qu'il n'y a pas eu de levée avec paiement du propriétaire (double facturation).

### 14. Fournisseur qui renvoie la pièce complète demandée
- Mail : Senlis Codra (05/10) : facture 26080351 complète (remorquage VW Caddy 1TGA969 en France, payé par carte).
- Décision : **joindre le PDF complet à la facture d'achat déjà encodée** (BILL/2026/08/0101) comme pièce principale ;
  classer dans Fournisseur Divers.
- Règle : pièce réclamée reçue → la joindre à la facture d'achat existante (pas de nouvel encodage), pièce principale,
  avec une note dans l'historique ; classer.

### 15. Touring BKO : « le lien bloque, envoyez la liste en Excel »
- Décision : traiter d'abord les réponses déjà données (9) avec le motif de Touring sur chaque fiche (sans frais,
  facturation OK, accord, remise en attente), puis envoyer l'Excel des dossiers restants dans le fil ; l'envoi
  mensuel joint désormais l'Excel et la réponse est suivie (relance J+7, alerte J+14).
- Règle : une réponse libre de Touring n'est jamais appliquée seule ; « annulation par le chauffeur » = sans frais
  avec ce motif ; « déjà facturé + accord » = facturation OK avec le n° d'accord.

### 16. AXA : « plus besoin de copie par mail pour les factures Peppol »
- Décision : AXA est déjà en ordre ; **classer**.
- Règle : AXA = Peppol seul pour une facture belge avec TVA ; dossiers étrangers et rappels par mail à network.bnl@.

### 17. Fournisseur qui envoie les avis demandés et propose de changer l'adresse de facturation
- Mail : Ethias (08/10) : avis de prime accidents du travail T3 2026 (virements ING du 01/07 : 1 686,62 € et 74,67 €) ;
  « devons-nous changer l'adresse de facturation ? ».
- Décision : **encoder les deux avis** (datés du 01/07, même compte que le trimestre suivant, PDF joint) et **les
  rapprocher des virements** ; **pièce reçue** et **PDF joint au point du dossier comptable** (réglé) ; **répondre**
  oui, nouvelle adresse Lefin 12, 4860 Pepinster ; classer.
- Règles : pièce reçue pour un virement sans facture → encoder la facture à la date du virement et lettrer ; mettre à
  jour le dossier de la comptable ; une adresse obsolète chez un fournisseur se corrige dès qu'il la propose.

### 18. Assistance qui paie une facture en entier sans déduire notre note de crédit
- Banque : Touring, 37 043,10 € le 02/10 (détail « Détails de paiement » dans info@ le 05/10, réf. 63000026358) pour
  9 factures, dont la 2026/08/200 à 514,25 € alors que la NC 2026-0278 (101,64 €, demandée par Touring le 02/09,
  émise le 23/09) y était lettrée → 101,64 € restaient en compte d'attente.
- Décision : **délettrer la NC** de la 2026/08/200 ; le reste du virement solde la 2026/08/200 en entier ; la NC
  reste **ouverte** et se lettrera quand Touring la déduira d'un prochain paiement.
- Règle : le détail de paiement de l'assistance fait foi ; pas de remboursement, pas d'OD de trop-perçu, pas de mail.
  Communication bancaire : numéros parfois collés ou coupés par la banque → retirer les espaces et vérifier chaque
  numéro contre les factures existantes.

### 19. Police : « le véhicule peut être récupéré par … après paiement des frais », sans date
- Mail : commissaire Lemaire (ZP Vesdre) à fourriere@ le 09/10 : Skoda Octavia 1TTZ315 (fiche 10137601) peut être
  récupérée par Mr YAR Ergin sur plateau ou remorque après paiement ; « sûrement la semaine prochaine ».
- Décision : c'est une **levée définitive** ; **sans date dans le document, la date du mail compte** (09/10) ;
  frais à charge de la personne qui reprend le véhicule ; châssis du mail ajouté à la fiche ; pas de réponse.
- Règle : levée sans date = date de réception du mail (VD Soft le fait seul depuis le 09/10). L'agent ne relance
  pas la police pour une date, et ne lève pas d'alarme pour ça.

### 20. Copie d'un PV d'expertise pour un sinistre d'avant VD Soft
- Mail : Cimex à fourriere@ (03/08) : PV d'expertise, Suzuki Swift 2DAZ720, sinistre du 13/06/2025.
- Décision : dossier de l'ancien système, déjà facturé, véhicule abandonné → **classer sans réponse** (Archive).
- Règle : une copie d'expertise sans demande, pour un dossier clos (facturé, abandon), se classe. L'agent ne
  répond pas et ne crée rien ; il ne cherche pas de fiche VD Soft pour un sinistre d'avant le 19/05/2026.

### 21. Parquet : « pas de réquisitoire pour ces états de frais »
- Mail : Mme Cornil (Parquet) à fourriere@ le 18/09 : réquisitoire demandé pour EDF-2026-0046, 0062 et 0063.
- Constat : 0046 (Ford Mustang) et 0063 (Hyundai Getz 2GVE545) concernent des fiches requalifiées en **AVP** après
  l'envoi ; 0062 (Peugeot 308) a une levée du 23/09 **à charge du client**. Aucun des trois n'aurait dû partir au Parquet.
- Décision : **brouillon de réponse** depuis fourriere@ (vouvoiement, signature « Le service Fourrière ») demandant de
  considérer les trois états de frais comme annulés, avec la raison pour chacun ; Olivier relit et envoie.
- Règle : un état de frais parti pour un AVP, ou pour des frais finalement à charge du propriétaire, se fait annuler
  auprès du Parquet ; il n'y a pas de réquisitoire à fournir. L'agent prépare le brouillon, il n'envoie pas.

### 22. Parquet : « nous n'avons pas reçu de facture » pour un dossier de plus de 6 mois
- Mails : fdj.pplge@ (06/10) et Mme Cornil (08/10) réclament les factures de 7 véhicules remis au Finshop (Kangoo
  25VB790, Audi S3 25VB2103, Astra 25VB2791, i20 26VB1091, Arosa 26VB1424, Partner 26VB1447, Juke 26VB1918).
- Constat : aucun état de frais ni aucune facture (mails envoyés, ERP). 6 dossiers ont plus de 6 mois depuis la prise
  en charge ; la Juke (11/05/2026) est encore dans le délai jusqu'au 11/11/2026.
- Règle d'Olivier (09/10) : demande d'état de frais pour un dossier de **plus de 6 mois** (depuis le début de la
  prestation) → **vérifier** s'il existe déjà une facture ou un état de frais ; **si oui, le renvoyer** ; **si non,
  répondre que nous sommes hors délai** et que nous n'enverrons rien (il serait refusé à la liquidation : on ne perd
  pas de temps). Dans le délai → l'état de frais suit le circuit normal.
- Ce que fait l'agent : la vérification (VD Soft, ERP, mails envoyés), puis un brouillon de réponse depuis
  fourriere@ (vouvoiement, « Le service Fourrière ») ; il n'envoie pas et ne génère pas d'état de frais hors délai.

### 23. Parquet : facture réclamée, dossier dans le délai mais sans réquisitoire
- Mail : Mme Cornil (08/10) : pas reçu de facture pour le dossier 26VB1918 (Nissan Juke 2BMT401, saisie du 11/05/2026
  avenue de Spa, remise au Finshop le 10/06/2026). Délai de 6 mois non dépassé (jusqu'au 11/11/2026).
- Constat : aucun réquisitoire (fiche, file des réquisitoires, boîtes fourriere@, info@, administration@, mobi@).
- Décision : **répondre que nous sommes toujours dans l'attente du réquisitoire et que sans lui nous ne pouvons pas
  facturer** ; l'état de frais suivra à sa réception (brouillon depuis fourriere@, Olivier envoie).
- Règle : pas d'état de frais sans réquisitoire (PDF ou JPG), même quand le Parquet le réclame. Nouvelle règle des
  états de frais (09/10) : UN seul état de frais par saisie — dépannage + gardiennage jusqu'au dernier jour du mois
  qui suit l'entrée au maximum (ou la remise Domaine / la levée si plus tôt) ; le gardiennage au-delà n'est plus facturé.
- Suite (09/10) : Olivier a retrouvé le réquisitoire dans l'ancien système (dossier legacy, le n° de PV était
  connu) → rattaché à la fiche, **EDF-2026-0098** (prise en charge + gardiennage du 11/05 au 10/06, 170,44 € TVAC)
  envoyé à Mme Cornil en réponse à son mail, avec le réquisitoire. Règle : pour un dossier legacy sans
  réquisitoire, demander à Olivier de chercher dans l'ancien système avant de répondre « en attente ».
