// src/app/avance-fonds/AvanceFondsClient.tsx
'use client';

import { useState, useRef } from 'react';
import { useRouter }        from 'next/navigation';

const PAYMENT_METHODS = [
  { value: 'cash',       label: '💵 Cash'      },
  { value: 'bancontact', label: '💳 Bancontact' },
  { value: 'card',       label: '💳 Carte'      },
  { value: 'virement',   label: '🏦 Virement'   },
];

type Step = 'photo' | 'details' | 'confirm' | 'success';

interface FormState {
  plate:         string;
  amountHtva:    string;
  paymentMethod: string;
  notes:         string;
  photoFile:     File | null;
  photoPreview:  string | null;
}

const EMPTY_FORM: FormState = {
  plate: '', amountHtva: '', paymentMethod: '',
  notes: '', photoFile: null, photoPreview: null,
};

export default function AvanceFondsClient({ user }: { user: any }) {
  const router      = useRouter();
  const fileRef     = useRef<HTMLInputElement>(null);
  const cameraRef   = useRef<HTMLInputElement>(null);

  const [step,    setStep]    = useState<Step>('photo');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [form,    setForm]    = useState<FormState>(EMPTY_FORM);

  // ── Photo ──────────────────────────────────────────────────
  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setForm(f => ({ ...f, photoFile: file, photoPreview: URL.createObjectURL(file) }));
    setStep('details');
  };

  // ── Upload vers Supabase Storage ───────────────────────────
  const uploadPhoto = async (file: File): Promise<string> => {
    const fd = new FormData();
    fd.append('file', file);
    const res  = await fetch('/api/advances/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Upload échoué');
    return data.url as string;
  };

  // ── Soumission ─────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!form.photoFile) return;
    setLoading(true);
    setError(null);
    try {
      const invoiceUrl = await uploadPhoto(form.photoFile);
      const res = await fetch('/api/advances', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plate:         form.plate.toUpperCase().trim(),
          amountHtva:    form.amountHtva,
          paymentMethod: form.paymentMethod,
          invoiceUrl,
          notes:         form.notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Erreur');
      setStep('success');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  };

  // ── Validation ─────────────────────────────────────────────
  const validateDetails = (): string | null => {
    if (!form.plate.trim())               return "Veuillez saisir l'immatriculation";
    if (!form.amountHtva)                 return 'Veuillez saisir le montant HTVA';
    if (parseFloat(form.amountHtva) <= 0) return 'Le montant doit être supérieur à 0';
    if (!form.paymentMethod)              return 'Veuillez sélectionner un mode de paiement';
    return null;
  };

  // ────────────────────────────────────────────────────────────
  // STEP : PHOTO
  // ────────────────────────────────────────────────────────────
  if (step === 'photo') return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6 gap-8">
      <div className="text-center">
        <div className="text-6xl mb-3">📄</div>
        <h1 className="text-2xl font-bold text-white">Avance de fonds</h1>
        <p className="text-gray-400 mt-2 text-sm">Photographiez la facture reçue chez le garage</p>
      </div>

      <div className="w-full max-w-sm flex flex-col gap-3">
        <button
          onClick={() => cameraRef.current?.click()}
          className="w-full py-5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700
                     text-white rounded-2xl font-semibold text-lg
                     flex items-center justify-center gap-3 transition-colors"
        >
          <span className="text-2xl">📷</span> Prendre une photo
        </button>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment"
               className="hidden" onChange={handlePhoto} />

        <button
          onClick={() => fileRef.current?.click()}
          className="w-full py-4 bg-gray-800 hover:bg-gray-700 active:bg-gray-900
                     text-gray-300 rounded-2xl font-medium
                     flex items-center justify-center gap-3 transition-colors"
        >
          <span className="text-xl">🗂️</span> Galerie / Fichier PDF
        </button>
        <input ref={fileRef} type="file" accept="image/*,application/pdf"
               className="hidden" onChange={handlePhoto} />
      </div>
    </div>
  );

  // ────────────────────────────────────────────────────────────
  // STEP : DETAILS
  // ────────────────────────────────────────────────────────────
  if (step === 'details') return (
    <div className="min-h-screen bg-gray-950 pb-10">
      <div className="max-w-md mx-auto px-4">
        <div className="flex items-center gap-3 py-4 mb-2">
          <button onClick={() => setStep('photo')} className="text-gray-400 hover:text-white">← Retour</button>
          <h1 className="text-xl font-bold text-white">Détails de l'avance</h1>
        </div>

        {form.photoPreview && (
          <div className="mb-5 rounded-2xl overflow-hidden border border-gray-800 bg-gray-900">
            <img src={form.photoPreview} alt="Aperçu facture"
                 className="w-full max-h-52 object-cover" />
            <button
              onClick={() => { setForm(f => ({ ...f, photoFile: null, photoPreview: null })); setStep('photo'); }}
              className="w-full py-2 text-gray-400 text-sm hover:text-white"
            >
              ✏️ Changer la photo
            </button>
          </div>
        )}

        <div className="flex flex-col gap-5">
          {/* Plaque */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Immatriculation *</label>
            <input
              type="text" inputMode="text" autoCapitalize="characters"
              placeholder="1-ABC-234" value={form.plate}
              onChange={e => setForm(f => ({ ...f, plate: e.target.value.toUpperCase() }))}
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3
                         text-white text-xl font-mono tracking-widest placeholder-gray-600
                         focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Montant HTVA */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Montant HTVA *</label>
            <div className="relative">
              <input
                type="number" inputMode="decimal" step="0.01" min="0"
                placeholder="0.00" value={form.amountHtva}
                onChange={e => setForm(f => ({ ...f, amountHtva: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3
                           text-white text-2xl font-semibold pr-14 placeholder-gray-600
                           focus:outline-none focus:border-blue-500"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-lg font-medium">€</span>
            </div>
          </div>

          {/* Mode de paiement */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">Mode de paiement *</label>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map(pm => (
                <button key={pm.value}
                  onClick={() => setForm(f => ({ ...f, paymentMethod: pm.value }))}
                  className={`py-3 rounded-xl font-medium transition-all ${
                    form.paymentMethod === pm.value
                      ? 'bg-blue-600 text-white ring-2 ring-blue-400'
                      : 'bg-gray-900 text-gray-300 border border-gray-700 hover:border-gray-500'
                  }`}
                >
                  {pm.label}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">
              Notes <span className="text-gray-600">(optionnel)</span>
            </label>
            <textarea rows={2} placeholder="Nom du garage, remarques..."
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3
                         text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>

          {error && <ErrorBox message={error} />}

          <button
            onClick={() => {
              const err = validateDetails();
              if (err) { setError(err); return; }
              setError(null);
              setStep('confirm');
            }}
            className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold text-lg mt-1"
          >
            Vérifier →
          </button>
        </div>
      </div>
    </div>
  );

  // ────────────────────────────────────────────────────────────
  // STEP : CONFIRM
  // ────────────────────────────────────────────────────────────
  if (step === 'confirm') return (
    <div className="min-h-screen bg-gray-950 pb-10">
      <div className="max-w-md mx-auto px-4">
        <div className="flex items-center gap-3 py-4 mb-2">
          <button onClick={() => setStep('details')} className="text-gray-400 hover:text-white">← Modifier</button>
          <h1 className="text-xl font-bold text-white">Confirmation</h1>
        </div>

        <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden mb-5">
          {form.photoPreview && (
            <img src={form.photoPreview} alt="Facture"
                 className="w-full max-h-60 object-cover border-b border-gray-800" />
          )}
          <div className="p-4 space-y-3">
            <Row label="Immatriculation" value={form.plate} mono />
            <Row label="Montant HTVA"    value={`${parseFloat(form.amountHtva).toFixed(2)} €`} />
            <Row label="Mode de paiement"
                 value={PAYMENT_METHODS.find(p => p.value === form.paymentMethod)?.label ?? form.paymentMethod} />
            {form.notes && <Row label="Notes" value={form.notes} />}
          </div>
        </div>

        <div className="bg-blue-950/40 border border-blue-900 rounded-xl p-4 mb-5 space-y-1.5">
          <p className="font-semibold text-blue-200 text-sm mb-2">Actions automatiques</p>
          <p className="text-blue-300 text-sm">✉️ Facture envoyée à la boîte achat Odoo</p>
          <p className="text-blue-300 text-sm">📋 Ligne ajoutée au devis client ({form.plate})</p>
          <p className="text-blue-300 text-sm">🚗 Véhicule renseigné sur le devis</p>
          <p className="text-blue-300 text-sm">💾 Enregistré dans l'application</p>
        </div>

        {error && <ErrorBox message={error} />}

        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full py-4 bg-green-600 hover:bg-green-500 active:bg-green-700
                     disabled:bg-gray-700 disabled:cursor-not-allowed
                     text-white rounded-2xl font-bold text-lg transition-colors"
        >
          {loading
            ? <span className="flex items-center justify-center gap-2"><span className="animate-spin">⏳</span> Envoi en cours…</span>
            : '✅ Confirmer et envoyer'
          }
        </button>
      </div>
    </div>
  );

  // ────────────────────────────────────────────────────────────
  // STEP : SUCCESS
  // ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6 text-center gap-7">
      <div className="text-8xl">✅</div>
      <div>
        <h2 className="text-2xl font-bold text-white">Avance enregistrée</h2>
        <p className="text-gray-400 mt-2 text-sm max-w-xs mx-auto">
          La facture a été transmise à Odoo Achats et le devis client a été mis à jour.
        </p>
      </div>

      <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4 w-full max-w-xs text-left space-y-3">
        <Row label="Plaque"    value={form.plate} mono />
        <Row label="Montant"   value={`${parseFloat(form.amountHtva).toFixed(2)} € HTVA`} />
        <Row label="Paiement"  value={PAYMENT_METHODS.find(p => p.value === form.paymentMethod)?.label ?? form.paymentMethod} />
      </div>

      <div className="flex flex-col w-full max-w-xs gap-3">
        <button onClick={() => router.push('/dashboard')}
          className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold">
          Tableau de bord
        </button>
        <button onClick={() => { setForm(EMPTY_FORM); setError(null); setStep('photo'); }}
          className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-medium">
          Nouvelle avance
        </button>
      </div>
    </div>
  );
}

// ── Utilitaires ───────────────────────────────────────────────
function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-3">
      <span className="text-gray-500 text-sm flex-shrink-0">{label}</span>
      <span className={`text-white text-sm text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="bg-red-950/50 border border-red-800 text-red-300 rounded-xl p-3 text-sm">
      {message}
    </div>
  );
}
