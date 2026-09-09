-- Mes Missions (chauffeur) : une fiche clôturée restait visible parce que son drapeau
-- « à encaisser » n'avait jamais été retiré (Franck, 22MXLZ du 19/07 — Olivier 09/09/2026).
-- Une fiche clôturée n'est plus à encaisser par le chauffeur : le drapeau tombe.
update incoming_missions
   set awaiting_payment = false, updated_at = now()
 where awaiting_payment = true
   and status in ('completed', 'to_invoice', 'invoiced', 'cancelled', 'ignored');
