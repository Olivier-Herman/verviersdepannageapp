-- Florent limité à Verviers Dépannage (Olivier 06/10/2026) : Dépannage Riga retiré
-- de ses sociétés (le bureau des agents le bloque déjà de son côté).
update agent_accounts set companies = array[1]::int[] where name = 'Florent';
notify pgrst, 'reload schema';
