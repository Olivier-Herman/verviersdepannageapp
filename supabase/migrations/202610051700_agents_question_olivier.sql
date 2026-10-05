-- Question d'un agent à Olivier (Olivier 05/10/2026) : ex. facture d'achat au
-- nom privé d'une personne → Telegram avec deux boutons ; la réponse revient à
-- l'agent. Nouveau statut « answered ».
alter table agent_proposals drop constraint if exists agent_proposals_status_check;
alter table agent_proposals add constraint agent_proposals_status_check
  check (status in ('to_validate','executing','executed','refused','returned','failed','answered'));

update agent_accounts set kinds = array_append(kinds, 'question_olivier')
  where name = 'Florent' and not ('question_olivier' = any(kinds));

notify pgrst, 'reload schema';
