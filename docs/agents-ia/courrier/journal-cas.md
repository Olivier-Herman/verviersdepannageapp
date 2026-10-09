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

### 24. JustInvoice « pages blanches » sur un dépôt inconnu de VD Soft
- Mail : bureau de taxation de Liège (16/09) : dossier 527906-26, « il n'y a que des pages blanches dans vos pièces
  jointes ». Dépôt du 10/08, rattaché à aucun état de frais de VD Soft.
- Décision : c'était un **dépôt de test** (pages vides) → **classer sans suite** (Frais de Justice), sans réponse.
- Règle : un dossier JustInvoice inconnu de VD Soft, daté de la période des essais (août 2026), est un test ; l'agent
  classe. S'il ne sait pas relier un dossier JustInvoice à un état de frais, il demande à Olivier avant d'agir.

### 25. JustInvoice « besoin d'une correction » sur un état de frais déjà validé
- Mail : bureau de taxation de Liège (18/09), dossier 535059-26 (EDF-2026-0024, VW Golf 2HSL359) : la saisie date du 25/06
  selon le réquisitoire (page 2) alors que l'état de frais dit 24/06 ; le gardiennage ne commence que le lendemain.
- Décision d'Olivier : **on suit leur demande** — un dossier arrivé sur JustInvoice a été validé par le Parquet / les
  frais de justice ; on **corrige l'état de frais** (même numéro) et on **renvoie la version corrigée** dans le dossier
  JustInvoice. Ici : saisie 25/06, gardiennage du 26/06 au 31/07 = 36 jours, 181,77 € TVAC au lieu de 183,65 €.
- Règle : pas de contestation ni de retrait d'un dossier JustInvoice ; on applique la correction demandée, même quand
  nos propres données disent autre chose (ici le réquisitoire se contredit : 24/06 en page 1, 25/06 en page 2).
- Ce que fait l'agent : met à jour l'état de frais (période, lignes, totaux), produit le PDF corrigé, le prépare pour le
  dépôt ; signale si une facture ERP a déjà été émise sur l'ancien montant (à corriger par note de crédit sur accord).
- Suite (09/10) : version corrigée **postée par VD Soft** dans le dossier JustInvoice (CostState v2, statut
  « Correction soumise »), via le même flux que le formulaire « Add extra files » du portail. La facture ERP
  2026/09/360 (183,65 €) émise sur l'ancien montant reste à ajuster après la nouvelle liquidation (1,88 € TVAC).

### 26. JustInvoice « approbation manquante » sur un dossier déposé trop tôt
- Mail : bureau de taxation (28/09), dossier 542250-26 (EDF-2026-0053, Peugeot 307 90698) : approbation manquante.
- Historique : le Parquet avait renvoyé l'état de frais (ne correspondait pas au réquisitoire) le 03/09 ; VD Soft l'a
  quand même déposé (bug corrigé le jour même) ; version corrigée envoyée au Parquet le 09/09, sans réponse depuis.
- Décision d'Olivier : **pas de relance** ; on attend l'approbation du Parquet et on l'envoie à ce moment-là dans le
  dossier 542250-26. Le mail de la taxation reste dans la boîte de réception. L'EDF-0053-B (15,10 €) reste tel quel.
- Règle : un état de frais qui a déjà un dossier JustInvoice ne fait jamais l'objet d'un deuxième dépôt : à
  l'approbation, VD Soft envoie l'approbation et l'état de frais à jour dans le dossier existant (correction).

### 27. Approbation par le Parquet d'une facture ERP d'avant le circuit des états de frais
- Mail : Mme Houyon (Parquet de Verviers, 18/09) : « ci-joint l'approbation de la facture et de la NC » — facture
  2026/05/522 (Audi Q2 1RTB478 volée, 230,84 €) et NC 2026-0150 (15,10 €), mention « ROJ-FJGK13 – Signature
  électronique octroyée », réquisitoire joint.
- Décision d'Olivier : **déposer sur JustInvoice** (facture approuvée + NC dans un seul PDF + réquisitoire) → dossier
  **563218-26**, noté dans le fil de la facture dans l'ERP ; mail classé (Frais de Justice).
- Règle : une approbation du Parquet part dans le circuit JustInvoice, même pour une facture faite dans l'ERP ; la NC
  approuvée avec la facture est jointe au même document.
- Incident : le SPF a déplacé l'adresse de dépôt (ancien flux désactivé) ; VD Soft relit désormais l'adresse active
  sur le portail quand elle est refusée.

### 28. JustInvoice « dossier hors délai, merci de transmettre la preuve d'envoi dans le délai légal de 6 mois »
- Mails : bureau de taxation, 02→08/07/2026, 39 dossiers (458926-26 … 458986-26) déposés fin juin pour des factures
  de 2022-2023 adressées au Parquet.
- Décision d'Olivier (09/10) : **on annule tout simplement** — pas de preuve d'envoi, pas de contestation.
- Retrouver la facture : par la **référence** (l'ancien numéro, ex. 20234714), pas par le numéro de l'ERP : les
  factures anciennes ont été importées sous un numéro 20257xxx avec l'ancien numéro en référence.
- Constat : 37 déjà annulées (notes de crédit, dont 9 « Hors délai » du 09/07) ; 2 encore ouvertes → notes de crédit
  2026-0329 (253,77 €, réf. 20232348) et 2026-0330 (54,12 €, réf. 20235679), motif « Hors délai · <référence> »,
  lettrées. Mails classés dans Frais de Justice.
- Règle : dossier JustInvoice déclaré hors délai → note de crédit totale « Hors délai · <référence> » sur la facture
  si elle est encore ouverte, puis classer. L'agent prépare, Olivier valide (écriture comptable).

### 29. JustInvoice : « cette facture a été payée » — doublon d'import resté ouvert
- Mail : taxation (07/07), dossier 458960-26 : facture 20233719 (2023) payée le 06/02/2026, statut mis en liquidation
  « pour la faire disparaître ».
- Constat : l'original 20233719 est soldé (NC 2025-0333 + paiement) ; son doublon d'import 20257347 (réf. 20233719)
  était resté ouvert.
- Décision : **une NC par facture** : NC totale 2026-0331 sur le doublon, motif « Doublon d'import · <réf> »,
  générée sans envoi (Envoyer, tous les canaux décochés), lettrée ; mail classé.
- Règle : une NC « hors délai » ou « doublon » vers le Parquet se génère SANS envoi (Envoyer + tout décocher).

### 30. JustInvoice : tarif de l'année de facturation appliqué à une prestation de l'année précédente
- Mails : taxation (30/06 et 01/07), dossiers 458905-26 (2026/02/105, enlèvement un samedi 2025 → tarif majoré 2025)
  et 458920-26 (2026/02/120, enlèvement 2025 facturé au tarif 2026).
- Décision d'Olivier : **NC totale et nouvelle facture pour chacune** (même quand la taxation ne demande qu'une NC) :
  NC 2026-0332 / 2026-0333 et factures 2026/10/192 (149,08 €) / 2026/10/193 (244,77 €) au tarif 2025 (articles
  « Parquet Enlèvement (Non Majoré 2025) » 92,01 € et « (Majoré 2025) » 138,03 €), générées sans envoi ; la nouvelle
  facture + la NC (un seul PDF) envoyées en correction dans le dossier JustInvoice → « Correction soumise ».
- Règle : on facture au tarif de l'année de la prestation (enlèvement : majoré le samedi/dimanche/nuit). Une
  correction de montant = NC totale + nouvelle facture, jamais une NC partielle.

### 31. JustInvoice : « réquisitoire non signé + heure d'enlèvement manquante (tarif de nuit) »
- Mail : taxation (01/07), dossier 458918-26, facture 2026/02/270 (226,26 €, enlèvement majoré 2025 du 05/12/2025).
- Décision d'Olivier : ni réquisitoire signé ni heure dans l'ancien système → **on annule en interne** : NC totale
  2026-0334, générée sans envoi, lettrée ; pas de nouvelle facture, rien vers JustInvoice ; mail classé.
- Règle : quand la pièce exigée par la taxation est introuvable, on annule en interne (NC sans envoi), sans répondre.

### 32. JustInvoice : correction demandée sur une facture émise hors délai
- Mail : taxation (21/05), dossier 428401-26, facture 2026/01/646 (170,79 €) : dates d'entreposage manquantes.
- Constat : prestation du 26/07/2025 (réquisitoire), facture du 30/01/2026 → émise après les 6 mois.
- Décision d'Olivier : **annuler en interne** (NC totale 2026-0335 sans envoi, lettrée), pas de correction ; mail classé.
- Règle : avant de corriger une facture à la demande de la taxation, vérifier le délai (6 mois entre le début de
  la prestation et la facture). Facture hors délai → annulation interne plutôt que correction.

### 33. Directive Peppol frais de justice (SPF Justice, 22/12/2025) — appliquée à partir du 10/10/2026
- Source : pièce jointe du rejet Peppol du 13/07/2026 (peppol.aca@just.fgov.be) ; lue en entier le 09/10.
- Décision d'Olivier : **uniquement pour les nouveaux documents, à partir du 10/10/2026** (rien d'avant n'est repris).
- Règles : facture et NC liées à un état de frais → N° de commande « ROJ-FJGK13 JINV<n° JustInvoice> » ; correction
  acceptée → état de frais corrigé dans le même dossier JustInvoice + NC envoyée par Peppol ; nouvelle facture par Peppol
  après liquidation ; 6 mois depuis la prestation pour l'état de frais ET la facture ; un seul n° JustInvoice par état
  de frais ; annulations internes = NC sans envoi.
- Incident du 09/10 : 3 NC (2026-0332, 0333, 0337) envoyées par Peppol avant la précision « à partir de demain » ;
  contenu correct (ROJ-FJGK13 JINV…), envoi irréversible.

### 34. JustInvoice : « maximum 62 jours de gardiennage par facture »
- Mails : taxation (02 et 06/07), 458932-26 (facture 2023 de 75 jours, dans le délai) et 458951-26 (facture 2023 de
  75 jours, émise hors délai).
- Décisions d'Olivier : 458951-26 → **annulation interne** (NC 2026-0336 sans envoi). 458932-26 → l'accord existe, on
  compte tout en **répartissant** : NC totale 2026-0337 + facture 2026/10/194 (enlèvement + 62 jours) + facture
  2026/10/195 (13 jours), total identique ; les trois en un PDF déposé en correction → « Correction soumise ».
- Règle : la taxation plafonne à 62 jours de gardiennage par facture ; quand le dossier a l'accord et est dans le délai,
  on répartit le total sur plusieurs factures sans rien perdre.

### 35. Tri « À traiter par Mobi » (fourriere@) — classements sans décision
- Classés sans action : mails du Domaine déjà lus par VD Soft (Dates IN, ventes d'épaves) → « Mail auto-géré » ;
  inventaires de parc, informations (liquidation, délibération AVP de la Ville), directive Peppol → Archive ;
  approbations anciennes, levée d'un véhicule déjà sorti, demande de réquisitoire pour une facture payée → Frais de Justice.
- Demande d'information vieille de 3 mois d'une secrétaire du Parquet partie en congé (« vas-tu faire les factures ? »)
  → **classée sans réponse** (Olivier 09/10).
- Règle : un mail dont l'objet est déjà réglé dans VD Soft ou l'ERP (lu, sorti, payé, annulé) se classe sans réponse.

### 36. Assistance qui réclame la « copie des frais avancés » d'une facture
- Mail : VAB (Fadoua Errahil, 07/07 + rappel 09/10), facture 2026/06/232, dossier 8282353 (VW Crafter 2ESA670) :
  forfait « Avance de fonds » 135 € (garage HP Assistance).
- Décision d'Olivier : **envoyer directement** la facture d'achat du garage (BILL/2026/04/0098, HP Assistance GmbH,
  135 €, PDF de l'ERP) en réponse depuis administration@ ; mail classé.
- Règle : le justificatif d'une avance de fonds = la facture d'achat du fournisseur (ERP, achats, même montant) ; on la
  joint à la réponse. Signaler si cette facture d'achat n'est pas payée (ici « non payée »).
