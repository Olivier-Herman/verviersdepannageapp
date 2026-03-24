// ============================================================
// VERVIERS DÉPANNAGE — Types TypeScript
// ============================================================

export type UserRole = 'driver' | 'dispatcher' | 'admin' | 'superadmin'

export type ModuleId =
  | 'encaissement'
  | 'depose'
  | 'depannage'
  | 'fourriere'
  | 'rentacar'
  | 'tgr'
  | 'avance_fonds'
  | 'documents'
  | 'check_vehicle'
  | 'admin'

export interface Module {
  id: ModuleId
  label: string
  description: string | null
  icon: string | null
  sort_order: number
  active: boolean
}

export interface User {
  id: string
  azure_id: string | null
  email: string
  name: string | null
  avatar_url: string | null
  role: UserRole
  phone: string | null
  active: boolean
  last_login: string | null
  created_at: string
  modules?: ModuleId[]
}

export interface UserModule {
  id: string
  user_id: string
  module_id: ModuleId
  granted: boolean
  granted_by: string | null
  granted_at: string
}

export interface VehicleBrand {
  id: number
  name: string
  country: string | null
  active: boolean
}

export interface VehicleModel {
  id: number
  brand_id: number
  name: string
  category: string | null
  year_from: number | null
  year_to: number | null
  active: boolean
}

export interface ListItem {
  id: string
  list_type: string
  value: string
  label: string
  sort_order: number
  active: boolean
  module_id: string | null
}

export interface CallShortcut {
  id: string
  label: string
  phone: string
  category: 'assistance' | 'police' | 'prive' | 'autre'
  module_id: string | null
  sort_order: number
  active: boolean
}

export type ServiceType = 'depannage' | 'fourriere' | 'rentacar' | 'tgr' | 'encaissement'
export type PaymentStatus = 'paid' | 'pending' | 'free'

export interface Intervention {
  id: string
  reference: string
  service_type: ServiceType
  driver_id: string | null
  plate: string | null
  vin: string | null
  brand_id: number | null
  model_id: number | null
  brand_text: string | null
  model_text: string | null
  motif_id: string | null
  motif_text: string | null
  location_address: string | null
  location_lat: number | null
  location_lng: number | null
  intervention_date: string
  amount: number | null
  payment_mode: string | null
  payment_status: PaymentStatus
  client_vat: string | null
  client_name: string | null
  client_address: string | null
  client_phone: string | null
  client_email: string | null
  notes: string | null
  odoo_invoice_id: number | null
  odoo_partner_id: number | null
  synced_to_odoo: boolean
  synced_at: string | null
  created_at: string
  updated_at: string
  driver?: User
  brand?: VehicleBrand
  model?: VehicleModel
}

export type DocType = 'permis' | 'carte_id' | 'certificat_medical' | 'attestation' | 'fiche_paie' | 'autre'
export type DocStatus = 'valid' | 'expiring' | 'expired' | 'pending'

export interface DriverDocument {
  id: string
  user_id: string
  doc_type: DocType
  label: string
  file_path: string | null
  expiry_date: string | null
  issued_date: string | null
  status: DocStatus
  uploaded_at: string
}

export interface FundAdvance {
  id: string
  driver_id: string | null
  invoice_file: string | null
  amount: number | null
  currency: string
  supplier_name: string | null
  supplier_country: string | null
  notes: string | null
  status: 'pending' | 'approved' | 'rejected' | 'reimbursed'
  created_at: string
}

export interface ViesResult {
  valid: boolean
  name?: string
  address?: string
  vatNumber?: string
  countryCode?: string
  requestDate?: string
}

export interface OdooPartner {
  id: number
  name: string
  vat: string | null
  street: string | null
  city: string | null
  phone: string | null
  email: string | null
}

// ── Check Véhicule ────────────────────────────────────────

export type CheckStatus = 'scheduled' | 'pending_claim' | 'in_progress' | 'completed'

export interface CheckVehicle {
  id: string
  name: string
  plate: string
  usual_driver_id: string | null
  active: boolean
  created_at: string
  driver?: { name: string } | null
}

export interface CheckTemplateItem {
  id: string
  label: string
  category: 'Documents' | 'Matériel' | 'Carrosserie' | 'Mécanique'
  order_index: number
  active: boolean
  created_at: string
}

export interface CheckItemResult {
  item_id: string
  label: string
  category: string
  ok: boolean | null
  comment: string
  photo_url: string
}

export interface VehicleCheck {
  id: string
  created_at: string
  updated_at: string
  triggered_by: string | null
  vehicle_id: string | null
  scheduled_date: string
  status: CheckStatus
  claimed_by: string | null
  claimed_at: string | null
  driver_notified_at: string | null
  completed_at: string | null
  results: CheckItemResult[] | null
  photos: string[] | null
  notes: string | null
  vehicle?: CheckVehicle | null
  triggered_by_user?: { id: string; name: string; email: string } | null
  claimed_by_user?: { id: string; name: string; email: string } | null
}
