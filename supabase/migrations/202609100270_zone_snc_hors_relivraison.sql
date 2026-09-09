-- Olivier 09/09/2026 : la zone SNC (Siabis non couvert) sort du module Relivraison.
-- Ses 20 véhicules attendent un paiement, pas une relivraison (4 adresses sur 20,
-- entrées de juin à août). Zone de parc normale, comme LABO / S / Verviers ;
-- l'onglet Relivraison et le compteur du menu ne comptent plus que K et K1.
update parc_zones set zone_type = null where key = 'SNC' and zone_type = 'relivraison';
