// Ce que voit quelqu'un en mode Chauffeur (Olivier 05/11/2026) : les mêmes écrans qu'un chauffeur. Sans accès base : aussi côté navigateur.
const MODULES_CHAUFFEUR = ['driver_missions', 'encaissement', 'depannage', 'rentacar', 'avance_fonds', 'documents', 'caisse', 'profil', 'francofolies', 'tgr', 'check_vehicle']

export type WorkMode = 'dispatch' | 'chauffeur'

export const chauffeurModules = (modules: string[]) => modules.filter(m => MODULES_CHAUFFEUR.includes(m))
