# Compatibilité VD Soft ↔ Odoo — verviers-depannage (Odoo 19.0+e) — 2026-09-30

34 modèles et 250 champs vérifiés (inventaire du 2026-09-30).

## ✅ Aucun champ ni modèle manquant


## Exceptions connues (acceptées)

- sale.order.x_studio_helpdesk_ticket_id — Outil ponctuel de migration TowSoft (admin/towsoft-migration/check-odoo-invoices), champ Studio supprimé — migration terminée
- sale.order.x_studio_vehicle_id — Idem

## Méthodes à essayer à la main sur la copie de test

- account.bank.statement.line : read, search_read
- account.fiscal.position : read
- account.journal : read
- account.move : action_post, button_cancel, button_draft, create, fields_get, message_post, read, read_group, search_count, search_read, unlink, write
- account.move.line : read, read_group, reconcile, remove_move_reconcile, search_read, write
- account.move.reversal : create, modify_moves, read, reverse_moves
- account.partial.reconcile : read
- account.payment : action_cancel, action_draft, read, search_read, unlink
- account.payment.method.line : search_read
- account.payment.register : action_create_payments, create
- account.tax : read
- fleet.vehicle : create, fields_get, read, search_read, write
- fleet.vehicle.assignation.log : search_read
- fleet.vehicle.log.contract : search_read
- fleet.vehicle.log.services : search_read
- fleet.vehicle.model : create, read, search_read
- fleet.vehicle.model.brand : create, search_read
- fleet.vehicle.tag : create, search_read
- helpdesk.tag : read, search_read
- helpdesk.ticket : create, fields_get, read, search_read, unlink, write
- ir.attachment : copy, create, read, search_read
- ir.model.fields : search_read
- mail.template : send_mail
- product.product : read, search_read
- project.project : search_read
- project.task : create, write
- project.task.type : search_read
- res.company : read, search_read
- res.country : search_read
- res.partner : create, read, search, search_read, write
- res.partner.category : read
- sale.advance.payment.inv : create, create_invoices
- sale.order : action_cancel, action_confirm, action_quotation_sent, create, message_post, read, search_read, write
- sale.order.template.line : search_read

## Appels dynamiques à relire

- src/lib/odoo-attachment.ts:56  odooRpc(resModel, 'message_post', [[resId]], { body, attachment_ids: [attachmentId], })