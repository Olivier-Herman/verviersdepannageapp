-- Vague 2 sécurité RLS (hygiène) : active RLS sur les tables RLS-off restantes.
-- Aucune n'a de GRANT anon (donc pas exposées via la clé publique) ni d'abonnement
-- realtime navigateur. service_role contourne RLS → zéro impact fonctionnel.
-- Objectif : advisor Supabase au vert, fin des mails rls_disabled_in_public.

alter table public.allianz_otp_pending enable row level security;
alter table public.app_settings enable row level security;
alter table public.assistant_conversations enable row level security;
alter table public.assistant_memory enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.assistant_tool_calls enable row level security;
alter table public.circuit_prestations enable row level security;
alter table public.cobrowse_sessions enable row level security;
alter table public.ct_convocations enable row level security;
alter table public.depots enable row level security;
alter table public.device_tokens enable row level security;
alter table public.dispatch_attempts_log enable row level security;
alter table public.dispatcher_on_duty enable row level security;
alter table public.error_logs enable row level security;
alter table public.evaluation_sessions enable row level security;
alter table public.evaluations enable row level security;
alter table public.fines enable row level security;
alter table public.garage_cancellation_requests enable row level security;
alter table public.garage_partners enable row level security;
alter table public.garage_user_partners enable row level security;
alter table public.inventaire_session_items enable row level security;
alter table public.inventaire_sessions enable row level security;
alter table public.kaze_webhook_events enable row level security;
alter table public.mecano_docs enable row level security;
alter table public.mecano_messages enable row level security;
alter table public.mission_billing_periods enable row level security;
alter table public.mission_invoice_drafts enable row level security;
alter table public.mission_remark_attachments enable row level security;
alter table public.mission_remarks enable row level security;
alter table public.mission_sources enable row level security;
alter table public.mission_warnings enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.orphan_scans enable row level security;
alter table public.police_saisie_motifs enable row level security;
alter table public.police_zones enable row level security;
alter table public.print_queue enable row level security;
alter table public.push_dedupe enable row level security;
alter table public.source_tariff_brackets enable row level security;
alter table public.source_tariff_lines enable row level security;
alter table public.source_tariffs enable row level security;
alter table public.tariff_rules enable row level security;
alter table public.towsoft_archive enable row level security;
alter table public.towsoft_migration_source enable row level security;
alter table public.towsoft_queue enable row level security;
alter table public.trucks enable row level security;
alter table public.vr_locations enable row level security;

notify pgrst, 'reload schema';
