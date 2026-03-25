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
  | 'missions'
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

// ── Missions entrantes (Phase 2) ──────────────────────────

export type MissionSource =
  | 'touring'
  | 'ethias'
  | 'vivium'
  | 'axa'
  | 'ardenne'
  | 'mondial'
  | 'vab'
  | 'police'
  | 'prive'
  | 'garage'
  | 'unknown'

export type MissionStatus =
  | 'new'
  | 'dispatching'
  | 'assigned'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'ignored'
  | 'parse_error'

export type MissionType =
  | 'remorquage'
  | 'depannage'
  | 'transport'
  | 'trajet_vide'
  | 'reparation_place'
  | 'autre'

export type DispatchMode = 'manual' | 'auto'

export type MissionSourceFormat = 'rtf' | 'email_plain' | 'docx' | 'pdf' | 'unknown'

export interface IncomingMission {
  id: string
  external_id: string
  dossier_number: string | null
  source: MissionSource
  source_format: MissionSourceFormat
  source_email_id: string | null

  mission_type: MissionType | null
  incident_type: string | null
  incident_description: string | null

  client_name: string | null
  client_phone: string | null
  client_address: string | null

  vehicle_plate: string | null
  vehicle_brand: string | null
  vehicle_model: string | null
  vehicle_vin: string | null
  vehicle_fuel: string | null
  vehicle_gearbox: string | null

  incident_address: string | null
  incident_city: string | null
  incident_country: string
  incident_lat: number | null
  incident_lng: number | null

  destination_name: string | null
  destination_address: string | null

  amount_guaranteed: number | null
  amount_currency: string

  incident_at: string | null
  received_at: string

  status: MissionStatus
  dispatch_mode: DispatchMode

  assigned_to: string | null
  assigned_at: string | null
  accepted_at: string | null
  completed_at: string | null

  odoo_order_id: number | null
  odoo_synced_at: string | null

  raw_content: string | null
  parsed_data: Record<string, unknown> | null
  parse_confidence: number | null

  created_at: string
  updated_at: string

  assigned_user?: { id: string; name: string; avatar_url: string | null } | null
}

export type MissionLogAction =
  | 'received'
  | 'parsed'
  | 'dispatched'
  | 'accepted'
  | 'refused'
  | 'reassigned'
  | 'completed'
  | 'cancelled'
  | 'odoo_synced'
  | 'error'

export interface MissionLog {
  id: string
  mission_id: string
  actor_id: string | null
  action: MissionLogAction
  notes: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}
