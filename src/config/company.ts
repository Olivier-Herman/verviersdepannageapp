// Constantes société — source unique de vérité.
// Référencées par les PDF/XLSX/email (relances, avances, etc.) pour
// rester cohérent partout sans repartir chercher dans les .env.
// Multi-tenant futur : c'est ce fichier qu'on dupliquera/templatera.

export const COMPANY = {
  name: 'Verviers Dépannage SA',
  address: 'Lefin 12, 4860 Pepinster',
  vat: 'BE0460.759.205',
  iban: 'BE26 3401 4658 5529',
  phone: '+32 (0)87/35.18.20',
  email: 'administration@verviersdepannage.com',
  website: 'verviersdepannage.com',
} as const
