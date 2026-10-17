// Ancienne adresse (17/10/2026) : le Bureau du jour a sa propre page, hors Administration.
import { redirect } from 'next/navigation'
export default function AncienBureau() { redirect('/bureau-du-jour') }
