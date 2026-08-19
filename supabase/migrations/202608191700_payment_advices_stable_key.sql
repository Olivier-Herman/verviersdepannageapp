-- Identité stable d'un avis de paiement.
--
-- L'idempotence tenait sur `mail_id`, l'identifiant Graph d'un message. Or cet
-- identifiant ENCODE LE DOSSIER : déplacer ou archiver un mail lui en donne un
-- nouveau. Le 19/08/2026, trois avis AWP du 12/08 avaient bougé de dossier — la
-- relecture les a pris pour des nouveaux et a créé des doublons, dont un avis
-- DÉJÀ RAPPROCHÉ (BEVO492091, paiement 2213) qui est réapparu dans la file
-- comme s'il restait à traiter.
--
-- On ajoute donc le Message-ID RFC822 (`internetMessageId` chez Graph), qui lui
-- ne change ni au déplacement, ni d'une boîte à l'autre. `mail_id` reste — il
-- sert à retélécharger la pièce jointe — mais il n'est plus l'identité.
-- Olivier 2026-08-19.

ALTER TABLE public.payment_advices
  ADD COLUMN IF NOT EXISTS internet_message_id text;

-- Partiel : les lignes déjà en base n'ont pas encore leur Message-ID, il est
-- rempli au prochain passage du cron.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_advices_imid
  ON public.payment_advices (internet_message_id)
  WHERE internet_message_id IS NOT NULL;

COMMENT ON COLUMN public.payment_advices.internet_message_id IS
  'Message-ID RFC822 — identité stable de l''avis. mail_id (id Graph) change quand le message change de dossier.';

NOTIFY pgrst, 'reload schema';
