-- RH : champs de la fiche employé (contrat, coordonnées).

alter table public.personnel
  add column if not exists poste        text,
  add column if not exists type_contrat text,   -- CDI, CDD, intérim, étudiant…
  add column if not exists date_entree  date,
  add column if not exists date_sortie  date,
  add column if not exists phone        text,
  add column if not exists email        text,
  add column if not exists notes        text,
  add column if not exists odoo_partner_id bigint;   -- res.partner Odoo (renseigné à la main) → sync fiche

notify pgrst, 'reload schema';
