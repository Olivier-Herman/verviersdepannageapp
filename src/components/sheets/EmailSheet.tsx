'use client'

import { useEffect, useState } from 'react'
import { X, ExternalLink, Download, Mail, Paperclip } from 'lucide-react'

interface Attachment {
  id:          string
  name:        string
  contentType: string
  size:        number
  isInline:    boolean
  contentId?:  string
}

interface Person { name: string; email: string }

interface MailFull {
  id:              string
  subject:         string
  from:            Person | null
  to:              Person[]
  cc:              Person[]
  receivedAt:      string
  bodyContentType: 'html' | 'text'
  body:            string
  hasAttachments:  boolean
  attachments:     Attachment[]
  webLink:         string
}

interface Props {
  mailbox:   string
  messageId: string
  isTop:     boolean
  zIndex:    number
  onClose:   () => void
}

const fmtDate = (iso: string) => {
  if (!iso) return ''
  return new Date(iso).toLocaleString('fr-BE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const fmtSize = (bytes: number) => {
  if (bytes < 1024)        return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

const fileIcon = (mime: string) => {
  if (!mime) return '📎'
  if (mime.startsWith('image/')) return '🖼️'
  if (mime === 'application/pdf') return '📄'
  if (mime.startsWith('audio/')) return '🎵'
  if (mime.startsWith('video/')) return '🎬'
  if (mime.includes('zip') || mime.includes('compressed')) return '🗜️'
  if (mime.includes('word'))  return '📝'
  if (mime.includes('excel') || mime.includes('spreadsheet')) return '📊'
  return '📎'
}

/** Remplace les cid:xxx dans le HTML par les URLs de notre endpoint d attachments
 *  pour que les images embedded s affichent. */
function rewriteInlineImages(html: string, mailbox: string, messageId: string, attachments: Attachment[]): string {
  if (!attachments.length) return html
  let out = html
  for (const a of attachments) {
    if (!a.isInline || !a.contentId) continue
    const url = `/api/mail/${encodeURIComponent(mailbox)}/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(a.id)}`
    // Patterns possibles : cid:CID@... ou cid:CID
    const escaped = a.contentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`cid:${escaped}`, 'gi'), url)
  }
  return out
}

export default function EmailSheet({ mailbox, messageId, isTop, zIndex, onClose }: Props) {
  const [mail, setMail]       = useState<MailFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    setLoading(true)
    setError(null)
    fetch(`/api/mail/${encodeURIComponent(mailbox)}/${encodeURIComponent(messageId)}`)
      .then(r => r.json())
      .then(j => {
        if (canceled) return
        if (!j.ok) setError(j.error || 'Erreur')
        else setMail(j.mail)
      })
      .catch(e => { if (!canceled) setError(e.message) })
      .finally(() => { if (!canceled) setLoading(false) })
    return () => { canceled = true }
  }, [mailbox, messageId])

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-stretch justify-end"
      style={{ zIndex }}
      onClick={isTop ? onClose : undefined}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-surface w-full max-w-3xl h-full overflow-hidden flex flex-col shadow-2xl border-l"
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-surface-hover flex items-center justify-between gap-3 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Mail size={20} className="text-brand flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="text-ink font-semibold text-base truncate">
                {mail?.subject || (loading ? 'Chargement…' : 'Email')}
              </h2>
              {mail && (
                <p className="text-ink-faint text-xs truncate">
                  {mailbox} · {fmtDate(mail.receivedAt)}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {mail?.webLink && (
              <a
                href={mail.webLink}
                target="_blank"
                rel="noopener"
                title="Ouvrir dans Outlook"
                className="p-2 text-ink-muted hover:text-brand hover:bg-surface-hover rounded-lg transition"
              >
                <ExternalLink size={16} />
              </a>
            )}
            <button
              onClick={onClose}
              className="p-2 text-ink-muted hover:text-ink hover:bg-surface-hover rounded-lg transition"
              title="Fermer (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="p-6 text-ink-faint text-sm italic">Chargement de l'email…</div>
          )}

          {error && (
            <div className="m-4 bg-critical-soft border border-critical rounded-lg p-3 text-critical text-sm">
              ⚠ {error}
            </div>
          )}

          {mail && (
            <>
              {/* Métadonnées */}
              <div className="px-5 py-3 bg-surface-2 border-b border-surface-hover space-y-1 text-xs">
                {mail.from && (
                  <div>
                    <span className="text-ink-faint">De : </span>
                    <span className="text-ink font-medium">{mail.from.name || mail.from.email}</span>
                    {mail.from.name && mail.from.email && <span className="text-ink-faint"> &lt;{mail.from.email}&gt;</span>}
                  </div>
                )}
                {mail.to.length > 0 && (
                  <div>
                    <span className="text-ink-faint">À : </span>
                    <span className="text-ink-secondary">{mail.to.map(p => p.name || p.email).join(', ')}</span>
                  </div>
                )}
                {mail.cc.length > 0 && (
                  <div>
                    <span className="text-ink-faint">Cc : </span>
                    <span className="text-ink-secondary">{mail.cc.map(p => p.name || p.email).join(', ')}</span>
                  </div>
                )}
              </div>

              {/* Pièces jointes (visibles, non-inline) */}
              {mail.attachments.filter(a => !a.isInline).length > 0 && (
                <div className="px-5 py-3 border-b border-surface-hover">
                  <div className="flex items-center gap-1.5 text-xs text-ink-faint uppercase tracking-wider mb-2">
                    <Paperclip size={12} />
                    <span>Pièces jointes ({mail.attachments.filter(a => !a.isInline).length})</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {mail.attachments.filter(a => !a.isInline).map(a => (
                      <a
                        key={a.id}
                        href={`/api/mail/${encodeURIComponent(mailbox)}/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(a.id)}`}
                        target="_blank"
                        rel="noopener"
                        className="flex items-center gap-2 p-2 bg-surface-2 hover:bg-surface-hover border rounded-lg text-xs text-ink hover:text-brand transition group"
                      >
                        <span className="text-lg flex-shrink-0">{fileIcon(a.contentType)}</span>
                        <div className="flex-1 min-w-0">
                          <div className="truncate font-medium">{a.name}</div>
                          <div className="text-[10px] text-ink-faint">{fmtSize(a.size)}</div>
                        </div>
                        <Download size={14} className="text-ink-faint group-hover:text-brand flex-shrink-0" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Corps */}
              <div className="px-2 py-2">
                {mail.bodyContentType === 'html' ? (
                  <iframe
                    title="Email body"
                    sandbox=""
                    srcDoc={rewriteInlineImages(mail.body, mailbox, messageId, mail.attachments)}
                    className="w-full min-h-[60vh] border-0"
                    style={{ background: 'white' }}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap break-words text-sm text-ink font-mono p-4">
                    {mail.body}
                  </pre>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
