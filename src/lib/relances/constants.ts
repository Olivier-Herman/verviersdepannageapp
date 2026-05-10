// Constantes module Relance Client.
// Match sur le NAME du tag Odoo (res.partner.category) plutot que sur l ID :
// plus robuste pour le multi-tenant (le tag pourra etre re-cree dans une
// autre instance Odoo avec le meme nom mais un id different).

export const RELANCE_EXCLUDED_TAG_NAME = 'Exclure relances'
