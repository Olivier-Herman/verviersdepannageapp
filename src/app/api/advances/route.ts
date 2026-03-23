// src/app/api/advances/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { createAdminClient }         from '@/lib/supabase';
import { addAdvanceToQuote }         from '@/lib/odoo';
import { sendAdvancePurchaseEmail }  from '@/lib/emails';

// ─── POST : créer une avance de fonds ────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { plate, amountHtva, paymentMethod, invoiceUrl, notes } = body;

    if (!plate || !amountHtva || !paymentMethod || !invoiceUrl) {
      return NextResponse.json(
        { error: 'Champs obligatoires manquants (plate, amountHtva, paymentMethod, invoiceUrl)' },
        { status: 400 }
      );
    }

    const supabase        = createAdminClient();
    const normalizedPlate = (plate as string).toUpperCase().trim();
    const htva            = parseFloat(amountHtva);

    // ── Retrouver le devis Odoo via la plaque ──────────────
    let odooQuoteId:    number | null = null;
    let odooLineId:     number | null = null;
    let odooVehicleSet                = false;

    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id')
      .eq('plate', normalizedPlate)
      .single();

    if (vehicle) {
      const { data: intervention } = await supabase
        .from('interventions')
        .select('odoo_quote_id')
        .eq('vehicle_id', vehicle.id)
        .not('odoo_quote_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (intervention?.odoo_quote_id) {
        odooQuoteId = intervention.odoo_quote_id;
        try {
          const result   = await addAdvanceToQuote(odooQuoteId!, normalizedPlate, htva);
          odooLineId     = result.lineId;
          odooVehicleSet = result.vehicleSet;
        } catch (odooErr) {
          console.error('[Odoo] addAdvanceToQuote:', odooErr);
        }
      }
    }

    // ── Email vers boîte achat Odoo ────────────────────────
    const { data: setting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'odoo_purchase_email')
      .single();

    let purchaseEmailSent = false;

    if (setting?.value) {
      const purchaseEmail = JSON.parse(setting.value) as string;
      try {
        await sendAdvancePurchaseEmail({
          to:            purchaseEmail,
          plate:         normalizedPlate,
          amountHtva:    htva,
          paymentMethod: paymentMethod as string,
          invoiceUrl:    invoiceUrl as string,
          employeeName:  session.user.name ?? session.user.email ?? 'Employé',
        });
        purchaseEmailSent = true;
      } catch (mailErr) {
        console.error('[Email] sendAdvancePurchaseEmail:', mailErr);
      }
    }

    // ── Sauvegarde Supabase ────────────────────────────────
    const { data: advance, error: insertError } = await supabase
      .from('fund_advances')
      .insert({
        user_id:             session.user.id,
        plate:               normalizedPlate,
        amount_htva:         htva,
        payment_method:      paymentMethod,
        invoice_url:         invoiceUrl,
        odoo_quote_id:       odooQuoteId,
        odoo_line_id:        odooLineId,
        odoo_vehicle_set:    odooVehicleSet,
        purchase_email_sent: purchaseEmailSent,
        notes:               notes ?? null,
        status:              odooLineId ? 'synced' : 'pending',
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return NextResponse.json({ success: true, advance });

  } catch (err: unknown) {
    console.error('[POST /api/advances]', err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}

// ─── GET : liste des avances ──────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit  = Math.min(parseInt(searchParams.get('limit')  ?? '20'), 100);
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0'),  0);

  const supabase = createAdminClient();

  let query = supabase
    .from('fund_advances')
    .select('*, users(name, email)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (session.user.role !== 'admin') {
    query = query.eq('user_id', session.user.id);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error('[GET /api/advances]', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }

  return NextResponse.json({ advances: data, total: count });
}
