// src/app/privacy-policy/page.tsx
// Page publique de politique de confidentialite, accessible sans login.
// URL : https://app.verviersdepannage.com/privacy-policy
// Necessaire pour App Store Connect (champ "Privacy Policy URL").

export const metadata = { title: 'Politique de confidentialité — VD Soft' }

export default function PrivacyPolicyPage() {
  const lastUpdate = '16 mai 2026'

  return (
    <main className="min-h-screen bg-surface text-ink">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <header className="mb-8 pb-6 border-b">
          <h1 className="font-display text-3xl font-bold mb-2">Politique de confidentialité</h1>
          <p className="text-ink-muted text-sm">VD Soft — application interne Verviers Dépannage SA</p>
          <p className="text-ink-faint text-xs mt-2">Dernière mise à jour : {lastUpdate}</p>
        </header>

        <article className="prose prose-sm max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold mb-2">1. Identité du responsable de traitement</h2>
            <p className="text-ink-secondary leading-relaxed">
              <strong>Verviers Dépannage SA</strong><br />
              Lefin 12, 4860 Pepinster, Belgique<br />
              BE 0460.759.205<br />
              Contact : <a href="mailto:info@verviersdepannage.be" className="text-brand hover:underline">info@verviersdepannage.be</a>
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">2. À qui s'adresse VD Soft</h2>
            <p className="text-ink-secondary leading-relaxed">
              VD Soft est une application <strong>professionnelle à usage interne</strong> destinée
              uniquement aux employés, chauffeurs et dispatcheurs de Verviers Dépannage SA.
              Elle n'est <strong>pas destinée au grand public</strong>. L'accès est réservé aux
              comptes professionnels créés par l'administrateur de la société.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">3. Données collectées</h2>
            <p className="text-ink-secondary leading-relaxed mb-3">
              Dans le cadre de l'exécution du contrat de travail et de la coordination des
              interventions de dépannage, VD Soft collecte et traite les données suivantes :
            </p>
            <ul className="list-disc pl-6 space-y-2 text-ink-secondary leading-relaxed">
              <li><strong>Identité du compte</strong> : nom, prénom, adresse e-mail professionnelle, rôle dans la société, numéro de téléphone professionnel.</li>
              <li><strong>Position GPS en temps réel</strong> : lorsque le chauffeur active le mode « En service », sa position est transmise toutes les 30 secondes au dispatcheur pour permettre la coordination des missions. La position cesse d'être transmise dès que le chauffeur désactive « En service ». La collecte continue en arrière-plan tant que ce mode est actif.</li>
              <li><strong>Photos d'intervention</strong> : photos prises par le chauffeur (véhicule, dégâts, signature client) liées à une mission précise. Aucune photo personnelle de la photothèque n'est collectée sans action explicite du chauffeur.</li>
              <li><strong>Signatures client</strong> : signature manuscrite collectée à la fin d'intervention sur les décharges.</li>
              <li><strong>Données d'intervention</strong> : adresse, plaque, marque/modèle, montants encaissés, motifs.</li>
              <li><strong>Données techniques</strong> : identifiants de session, jetons de notification push (APNs), versions de l'application.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">4. Finalités du traitement</h2>
            <ul className="list-disc pl-6 space-y-1 text-ink-secondary leading-relaxed">
              <li>Coordination opérationnelle des interventions de dépannage et de remorquage.</li>
              <li>Affectation automatique des missions au chauffeur le plus proche.</li>
              <li>Facturation et gestion des paiements client.</li>
              <li>Traçabilité légale des interventions (décharges signées, photos).</li>
              <li>Notifications push pour l'attribution de nouvelles missions et alertes opérationnelles.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">5. Base légale (RGPD)</h2>
            <p className="text-ink-secondary leading-relaxed">
              Le traitement est fondé sur (a) <strong>l'exécution du contrat de travail</strong> entre
              Verviers Dépannage SA et le chauffeur/employé, et (b) <strong>l'intérêt légitime</strong>
              de l'entreprise dans la coordination de ses opérations de service de dépannage.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">6. Hébergement et sous-traitants</h2>
            <p className="text-ink-secondary leading-relaxed mb-2">Les données sont hébergées dans l'Union européenne via :</p>
            <ul className="list-disc pl-6 space-y-1 text-ink-secondary leading-relaxed">
              <li><strong>Supabase</strong> (base de données + stockage, région UE)</li>
              <li><strong>Vercel</strong> (hébergement applicatif)</li>
              <li><strong>Microsoft Azure AD</strong> (authentification)</li>
              <li><strong>Odoo</strong> (gestion commerciale interne)</li>
              <li><strong>Apple APNs / Google FCM</strong> (notifications push)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">7. Durée de conservation</h2>
            <ul className="list-disc pl-6 space-y-1 text-ink-secondary leading-relaxed">
              <li>Position GPS : non conservée (seule la dernière position est gardée, écrasée à chaque ping).</li>
              <li>Photos et décharges d'intervention : <strong>10 ans</strong> (obligation légale belge en cas de litige).</li>
              <li>Données comptables (factures, encaissements) : <strong>7 ans</strong> (obligation comptable belge).</li>
              <li>Compte utilisateur : durée du contrat de travail + 1 an, puis anonymisation.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">8. Droits des personnes</h2>
            <p className="text-ink-secondary leading-relaxed">
              Conformément au RGPD, chaque employé peut demander à tout moment :
              accès, rectification, effacement (sous réserve des obligations légales),
              limitation, opposition au traitement, portabilité de ses données.
              <br /><br />
              Pour exercer un droit, contacter : <a href="mailto:info@verviersdepannage.be" className="text-brand hover:underline">info@verviersdepannage.be</a>
              <br /><br />
              Une réclamation peut être adressée à l'<a href="https://www.autoriteprotectiondonnees.be" className="text-brand hover:underline" target="_blank" rel="noopener">Autorité de protection des données belge (APD)</a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">9. Sécurité</h2>
            <p className="text-ink-secondary leading-relaxed">
              Toutes les communications entre l'application et nos serveurs sont chiffrées via TLS.
              L'authentification utilise OAuth 2.0 (Microsoft Azure AD, Google). Les données sont
              stockées dans des bases avec contrôle d'accès par rôle.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-2">10. Modifications</h2>
            <p className="text-ink-secondary leading-relaxed">
              Cette politique peut être mise à jour. La date de dernière mise à jour est affichée
              en tête de document. Les modifications substantielles seront notifiées aux utilisateurs
              via une notification dans l'application.
            </p>
          </section>
        </article>

        <footer className="mt-12 pt-6 border-t text-ink-faint text-xs text-center">
          VD Soft · Verviers Dépannage SA · {new Date().getFullYear()}
        </footer>
      </div>
    </main>
  )
}
