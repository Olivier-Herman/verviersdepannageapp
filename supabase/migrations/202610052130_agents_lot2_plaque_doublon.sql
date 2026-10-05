-- Lot 2 de Florent (Olivier 05/10/2026) : plaque sur facture d'achat et annulation
-- d'un brouillon en double (mail + Peppol), tous deux faits seuls.
update agent_accounts set kinds = array(select distinct unnest(kinds || array['plaque_achat', 'annulation_doublon'])),
  direct_kinds = array(select distinct unnest(direct_kinds || array['plaque_achat', 'annulation_doublon']))
  where name = 'Florent';
notify pgrst, 'reload schema';
