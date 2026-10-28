-- Avis de paiement ANWB (« Remittance file », PDF « Remittance Advice ») lus comme ceux d'IMA et d'AWP
-- (Olivier 28/10/2026 : « il faut lire les ANWB »).
alter table payment_advices drop constraint if exists payment_advices_provider_check;
alter table payment_advices add constraint payment_advices_provider_check check (provider in ('ima', 'awp', 'anwb'));

notify pgrst, 'reload schema';
