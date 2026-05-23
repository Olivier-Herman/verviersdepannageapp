// src/lib/print/zpl-templates/index.ts
//
// Registre central des templates d etiquettes ZPL. Toute la bibliotheque
// admin (/admin/labels) se sert de ce registre — pour ajouter un nouveau
// template, creer un fichier dans ce dossier puis l ajouter ici.
//
// Chaque template expose :
//   - key       : identifiant stable (ex: 'rel', 'parc-entree')
//   - name      : nom affiche dans la bibliotheque
//   - icon      : emoji (peut aussi etre un nom Lucide)
//   - category  : pour regroupement UI (mission / fixe / societe)
//   - description : aide affichee dans la card
//   - data_source : 'odoo_ticket' | 'mission' | 'static'
//                   pilote comment recuperer les donnees au moment de l impression
//   - build     : fonction qui prend les donnees et retourne le ZPL final

import { buildParcLabelZPL,  type ParcLabelData  } from './parc-label'
import { buildRelLabelZPL,   type RelLabelData   } from './rel'

export type LabelCategory = 'mission' | 'fixe' | 'societe'
export type LabelDataSource = 'odoo_ticket' | 'mission' | 'static'

export interface LabelTemplate {
  key:          string
  name:         string
  icon:         string
  category:     LabelCategory
  description:  string
  data_source:  LabelDataSource
  build:        (data: any) => string
}

export const LABEL_TEMPLATES: LabelTemplate[] = [
  {
    key:         'parc-entree',
    name:        'Entrée parc',
    icon:        '🏭',
    category:    'mission',
    description: 'Etiquette colle au vehicule a l entree en parc fourriere. Motif + date + QR grand + note.',
    data_source: 'odoo_ticket',
    build:       (data: ParcLabelData) => buildParcLabelZPL(data),
  },
  {
    key:         'rel',
    name:        'Relivraison (REL)',
    icon:        '🚚',
    category:    'mission',
    description: 'Etiquette pour mission REL. QR petit + plaque + vehicule + assistance + adresse de relivraison.',
    data_source: 'mission',
    build:       (data: RelLabelData) => buildRelLabelZPL(data),
  },
  // Ajouter ici les futurs templates : DOM, épave société X, restitution client, etc.
]

export function getLabelTemplate(key: string): LabelTemplate | undefined {
  return LABEL_TEMPLATES.find(t => t.key === key)
}

export function getLabelTemplatesByCategory(category: LabelCategory): LabelTemplate[] {
  return LABEL_TEMPLATES.filter(t => t.category === category)
}
