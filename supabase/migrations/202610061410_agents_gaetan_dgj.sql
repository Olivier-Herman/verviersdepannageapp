-- Gaëtan, DGJ VHU (société 3), mise en route (06/10/2026) : il PROPOSE seulement,
-- tout passe par la validation d'Olivier (aucun envoi direct).
update agent_accounts set companies = array[3]::int[],
  kinds = array['facture_achat', 'plaque_achat', 'annulation_doublon', 'question_olivier'],
  direct_kinds = '{}'
  where name = 'Gaëtan';
notify pgrst, 'reload schema';
