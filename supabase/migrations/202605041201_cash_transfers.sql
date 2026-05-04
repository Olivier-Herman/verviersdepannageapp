-- ============================================================
-- Refonte transfert peer-to-peer atomique avec validation push
-- Phase 3 du chantier caisse, créé le 2026-05-04.
-- À COLLER DANS Supabase SQL Editor.
-- ============================================================

-- ── 1. Table des demandes de transfert ──────────────────────
CREATE TABLE IF NOT EXISTS cash_transfers (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id             uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  receiver_id           uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount                numeric(12, 2) NOT NULL CHECK (amount > 0),
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'confirmed', 'refused', 'cancelled')),
  notes                 text,
  sender_movement_id    uuid REFERENCES cash_register(id) ON DELETE SET NULL,
  receiver_movement_id  uuid REFERENCES cash_register(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  resolved_at           timestamptz,
  CHECK (sender_id <> receiver_id)
);

CREATE INDEX IF NOT EXISTS idx_cash_transfers_sender_pending
  ON cash_transfers(sender_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_cash_transfers_receiver_pending
  ON cash_transfers(receiver_id) WHERE status = 'pending';

-- ── 2. Activer Realtime sur la table ────────────────────────
-- Permet au client browser de recevoir les UPDATE de status en temps réel
-- (utilisé par l'écran d'attente côté sender pour fermer dès résolution).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'cash_transfers'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE cash_transfers';
  END IF;
END $$;

-- ── 3. Fonction RPC atomique ────────────────────────────────
-- Effectue débit sender + crédit receveur dans une SEULE transaction.
-- Retourne le solde sender APRÈS pour signaler les écarts de caisse (solde négatif).
CREATE OR REPLACE FUNCTION transfer_cash_atomic(p_transfer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_transfer             cash_transfers%ROWTYPE;
  v_sender_movement_id   uuid;
  v_receiver_movement_id uuid;
  v_sender_name          text;
  v_receiver_name        text;
  v_balance_after        numeric;
  v_balance_before       numeric;
  v_alert_negative       boolean;
BEGIN
  -- Lock + lecture du transfert
  SELECT * INTO v_transfer FROM cash_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'transfer not found');
  END IF;
  IF v_transfer.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'transfer not pending',
                              'current_status', v_transfer.status);
  END IF;

  SELECT name INTO v_sender_name   FROM users WHERE id = v_transfer.sender_id;
  SELECT name INTO v_receiver_name FROM users WHERE id = v_transfer.receiver_id;

  -- Débit du donneur
  INSERT INTO cash_register (driver_id, amount, type, verified_by, verified_at, notes)
  VALUES (
    v_transfer.sender_id, v_transfer.amount, 'remise',
    v_transfer.receiver_id, now(),
    COALESCE(NULLIF(v_transfer.notes, ''), 'Transfert vers ' || COALESCE(v_receiver_name, 'inconnu'))
  )
  RETURNING id INTO v_sender_movement_id;

  -- Crédit du receveur
  INSERT INTO cash_register (driver_id, amount, type, verified_by, verified_at, notes)
  VALUES (
    v_transfer.receiver_id, v_transfer.amount, 'reception',
    v_transfer.receiver_id, now(),
    COALESCE(NULLIF(v_transfer.notes, ''), 'Réception de ' || COALESCE(v_sender_name, 'inconnu'))
  )
  RETURNING id INTO v_receiver_movement_id;

  -- Solde sender APRÈS débit (somme algébrique de tous ses mouvements)
  SELECT COALESCE(SUM(CASE
    WHEN type IN ('encaissement', 'reception') THEN amount
    WHEN type = 'remise'                       THEN -amount
    ELSE 0
  END), 0)
  INTO v_balance_after
  FROM cash_register
  WHERE driver_id = v_transfer.sender_id;

  v_balance_before := v_balance_after + v_transfer.amount;
  v_alert_negative := v_balance_after < 0;

  -- Marquer le transfert confirmé + lier les mouvements créés
  UPDATE cash_transfers
  SET status               = 'confirmed',
      resolved_at          = now(),
      sender_movement_id   = v_sender_movement_id,
      receiver_movement_id = v_receiver_movement_id
  WHERE id = p_transfer_id;

  RETURN jsonb_build_object(
    'ok',                      true,
    'sender_movement_id',      v_sender_movement_id,
    'receiver_movement_id',    v_receiver_movement_id,
    'sender_balance_before',   v_balance_before,
    'sender_balance_after',    v_balance_after,
    'alert_negative_balance',  v_alert_negative
  );
END;
$$;
