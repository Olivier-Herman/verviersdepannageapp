-- VD Soft dans l'appel, palier 1 (Olivier 24/11/2026) : un appel d'une option du standard Teams passe par VD Soft
-- avant la file d'attente. VD Soft lit le numéro dès la sonnerie, cherche la fiche, prévient les agents du service
-- (PC et GSM) et renvoie l'appel vers la file. Essai sur une touche cachée (9) puis sur l'option « Fourrière ».
-- Rien ne se passe tant que telephonie_config.actif est faux.
-- files.<clé>.ra_vdsoft : ObjectId du compte de ressource Teams relié à VD Soft (touche 9 puis option Fourrière) ;
-- files.<clé>.renvoi    : cible de la file Teams, ex. {"microsoftTeamsApp": {"appId": "<ObjectId du compte de la file>"}} ;
-- files.<clé>.mode      : 'redirect' (sans décrocher, repli automatique sur 'transfert') ou 'transfert'.

create table if not exists appels_entrants (
  id          text primary key,              -- identifiant de l'appel chez Microsoft
  debut       timestamptz not null default now(),
  numero      text,
  file        text,                          -- clé de la file (telephonie_config.files)
  mission_id  uuid references incoming_missions(id) on delete set null,
  fiches      int not null default 0,        -- nombre de fiches pour ce numéro
  statut      text not null default 'recu' check (statut in ('recu', 'renvoye', 'echec')),
  erreur      text,
  delai_ms    int,                           -- temps entre la sonnerie et le renvoi vers la file
  mode        text,                          -- 'redirect' (renvoi sans décrocher) ou 'transfert' (décroché puis transféré)
  connexion_id text,                         -- identifiant de la connexion quand VD Soft a décroché
  contexte    jsonb                          -- ce qu'il faut pour transférer (cible, sujet affiché dans Teams)
);
create index if not exists appels_entrants_debut on appels_entrants (debut desc);
alter table appels_entrants disable row level security;
grant all on appels_entrants to service_role;

insert into app_settings (key, value, updated_at) values ('telephonie_config', '{
  "actif": false,
  "files": {
    "fourriere": {
      "nom": "Fourrière service",
      "prevenir": ["29df3445-f452-4ebc-a7bb-c16a8377289b", "eda29707-c9c7-47b5-ab21-084ea22201bc"],
      "ra_vdsoft": null,
      "renvoi": null,
      "mode": "redirect"
    }
  },
  "alerte": ["mobi@verviersdepannage.be"]
}', now())
on conflict (key) do nothing;

notify pgrst, 'reload schema';
