// Dictionnaire albanais (Shqip). Traductions a valider avec le chauffeur.
// Convention : meme structure que fr.ts. Si une cle manque, fallback sur fr.

import type { Dictionary } from './fr'

// Note : albanais Tosk standard (forme officielle, lue par tous les Albanais).
// Conventions :
//  - Tutoiement direct (registre informel, l app s adresse au chauffeur)
//  - Termes techniques metiers (depanneuse, mission, livraison) en terminologie
//    courante. A valider en usage par le chauffeur natif.

export const sq: Dictionary = {
  common: {
    save:        'Ruaj',
    cancel:      'Anulo',
    close:       'Mbyll',
    back:        'Kthehu',
    yes:         'Po',
    no:          'Jo',
    ok:          'Në rregull',
    loading:     'Duke ngarkuar…',
    error:       'Gabim',
    confirm:     'Konfirmo',
    delete:      'Fshi',
    edit:        'Modifiko',
    search:      'Kërko',
    refresh:     'Rifresko',
    next:        'Tjetri',
    previous:    'Mëparshmi',
    today:       'Sot',
    yesterday:   'Dje',
    tomorrow:    'Nesër',
    none:        'Asnjë',
    optional:    'Opsionale',
    required:    'E detyrueshme',
    add:         'Shto',
    update:      'Përditëso',
    settings:    'Cilësimet',
    profile:     'Profili',
    logout:      'Dil',
    language:    'Gjuha',
  },

  nav: {
    dashboard:     'Paneli',
    search:        'Kërko',
    my_missions:   'Misionet e mia',
    missions:      'Misionet',
    new_mission:   'Mision i ri',
    cash:          'Arka',
    advance:       'Paradhënie',
    park:          'Parkimi',
    check:         'Kontroll i mjetit',
    finished:      'Misionet e përfunduara',
    services_tgr:  'TGR Touring',
    help:          'Ndihmë',
    profile:       'Profili im',
  },

  missions: {
    title:        'Misionet e mia',
    empty:        'Asnjë mision në vazhdim',
    accept:       'Prano',
    refuse:       'Refuzo',
    en_route:     'Në rrugë',
    on_site:      'Në vend',
    loaded:       'I ngarkuar',
    delivered:    'I dorëzuar',
    finish:       'Përfundo',
    in_progress:  'Në vazhdim',
    pending:      'Në pritje',
    completed:    'I përfunduar',
    cancelled:    'I anuluar',
    address_from: 'Adresa e marrjes',
    address_to:   'Adresa e dorëzimit',
    vehicle:      'Mjeti',
    plate:        'Targa',
    client:       'Klienti',
    source:       'Burimi',
    notes:        'Shënime',
    photo:        'Foto',
    take_photo:   'Bëj një foto',
    scan_plate:   'Skano targën',
    scan_vin:     'Skano VIN-in',
    payment:      'Pagesa',
    no_charge:    'Pa pagesë',
    truck:        'Karroatrec',
  },

  status: {
    new:         'I ri',
    assigned:    'I caktuar',
    en_route:    'Në rrugë',
    on_site:     'Në vend',
    loaded:      'I ngarkuar',
    delivered:   'I dorëzuar',
    to_invoice:  'Për faturim',
    completed:   'I përfunduar',
    cancelled:   'I anuluar',
  },

  payment: {
    cash:        'Para në dorë',
    card:        'Kartë bankare',
    transfer:    'Transfertë',
    invoice:     'Me faturë',
    qr:          'QR kod',
    no_charge:   'Pa pagesë',
    amount:      'Shuma',
    method:      'Mënyra e pagesës',
    receipt:     'Fatura',
    paid:        'Paguar',
    unpaid:      'Pa paguar',
  },

  notifications: {
    new_mission:        'Mision i ri i marrë',
    mission_assigned:   'Mision i caktuar',
    mission_updated:    'Misioni u përditësua',
    permission_request: 'Aktivizo njoftimet që të mos humbasësh asnjë mision',
  },

  errors: {
    generic:       'Ndodhi një gabim',
    network:       'Asnjë lidhje interneti',
    unauthorized:  'Akses i refuzuar',
    not_found:     'Nuk u gjet',
    try_again:     'Provo përsëri',
  },

  audio: {
    listen:        'Dëgjo',
    stop:          'Ndalo',
    play_again:    'Dëgjo përsëri',
    speed_slow:    'Ngadalë',
    speed_normal:  'Normal',
    speed_fast:    'Shpejt',
  },
}
