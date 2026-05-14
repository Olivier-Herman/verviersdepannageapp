// src/lib/notifications/sounds.ts
//
// Mapping notif_type → son a jouer cote client.
//
// Les fichiers attendus dans /public/sounds/ (a deposer par Olivier depuis
// Mixkit, libres de droits). Si un fichier est absent, l'Audio() echoue
// silencieusement → la notif s'affiche quand meme sans son.

export const NOTIFICATION_SOUNDS: Record<string, string> = {
  // Mission entrante "douce" (chauffeur C1) — son court bell
  new_mission_received:         '/sounds/bell-notification.wav',
  mission_assigned_manual:      '/sounds/bell-notification.wav',

  // Demande de dispo auto-dispatch (chauffeur C2+) — alarme urgente
  auto_dispatch_dispo_request:  '/sounds/warning-alarm-buzzer.wav',

  // Notif info cote dispatch — chime moyen
  auto_dispatch_refused:        '/sounds/positive-notification.wav',
  auto_dispatch_timeout:        '/sounds/positive-notification.wav',
  payment_validated:            '/sounds/positive-notification.wav',
  check_vehicule_due:           '/sounds/positive-notification.wav',
  email_parse_error:            '/sounds/positive-notification.wav',
  garde_uncovered:              '/sounds/positive-notification.wav',

  // Escalade dispatcher de garde — sirene
  escalation_call:              '/sounds/emergency-siren-alert.wav',
}

/**
 * Joue le son associe a un type de notif. Fail silencieux si le fichier
 * n'existe pas ou si l'autoplay est bloque par le navigateur.
 */
export async function playNotificationSound(type: string): Promise<void> {
  const src = NOTIFICATION_SOUNDS[type]
  if (!src) return
  try {
    const audio = new Audio(src)
    audio.volume = 0.7
    await audio.play()
  } catch (e) {
    // Autoplay bloque (navigateur exige interaction user d'abord) ou fichier 404
    console.debug('[notifications] sound skip:', e instanceof Error ? e.message : e)
  }
}
