-- Rémi, Dépannage Riga (Olivier 06/10/2026) : valide seul une facture d'achat quand il est
-- certain (tout canal, sans seuil) ; plaque, doublon, ticket, rapprochement de banque et
-- question passent par Olivier pendant la mise en route.
update agent_accounts set companies = array[2]::int[],
  kinds = array['facture_achat', 'plaque_achat', 'annulation_doublon', 'ticket_achat', 'rapprochement_banque', 'question_olivier'],
  direct_kinds = array['facture_achat']
  where name = 'Rémi';
notify pgrst, 'reload schema';
