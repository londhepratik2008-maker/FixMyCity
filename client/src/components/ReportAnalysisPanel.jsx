import { Badge, Card, CardContent, CardHeader } from './UI'
import { ShieldCheck, ShieldAlert, ShieldQuestion, FileSearch, Sparkles, AlertCircle } from 'lucide-react'

const statusConfig = {
  ACCEPTED: {
    label: 'ACCEPTED',
    color: 'var(--accent-green)',
    bg: 'var(--accent-green-dim)',
    icon: ShieldCheck,
    blurb: 'AI confirmed a genuine road defect in the original citizen photo.'
  },
  INVALID_EVIDENCE: {
    label: 'INVALID EVIDENCE',
    color: 'var(--accent-red)',
    bg: 'var(--accent-red-dim)',
    icon: ShieldAlert,
    blurb: 'AI rejected the original photo — it does not show a road defect.'
  },
  MANUAL_REVIEW: {
    label: 'MANUAL REVIEW',
    color: 'var(--accent-amber)',
    bg: 'var(--accent-amber-dim)',
    icon: ShieldQuestion,
    blurb: 'AI was uncertain — an officer must confirm the original evidence.'
  }
}

const qualityTone = {
  GOOD: 'var(--accent-green)',
  FAIR: 'var(--accent-amber)',
  POOR: 'var(--accent-red)',
  INSUFFICIENT: 'var(--accent-red)'
}

export default function ReportAnalysisPanel({ analysis, complaintId }) {
  if (!analysis || typeof analysis !== 'object') return null

  const cfg = statusConfig[analysis.evidenceStatus] || statusConfig.MANUAL_REVIEW
  const StatusIcon = cfg.icon
  const confidence = typeof analysis.confidence === 'number' ? analysis.confidence : null
  const qualityColor = qualityTone[analysis.evidenceQuality] || 'var(--text-muted)'

  return (
    <Card className="border-[var(--border-subtle)] overflow-hidden">
      <CardHeader className="bg-[var(--bg-card-hover)] border-b border-[var(--border-subtle)]">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: cfg.bg }}>
              <StatusIcon className="w-6 h-6" style={{ color: cfg.color }} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">AI Report Validation</h3>
              <p className="text-sm text-[var(--text-muted)]">Original citizen photo · complaint {complaintId}</p>
            </div>
          </div>
          <Badge variant={analysis.evidenceStatus === 'ACCEPTED' ? 'success' : analysis.evidenceStatus === 'INVALID_EVIDENCE' ? 'danger' : 'warning'}>
            {cfg.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-5">
        <div className="p-4 rounded-xl border" style={{ backgroundColor: cfg.bg, borderColor: cfg.color }}>
          <div className="flex items-start gap-3">
            <StatusIcon className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: cfg.color }} />
            <div className="min-w-0">
              <p className="text-sm font-semibold" style={{ color: cfg.color }}>
                {cfg.label}
                {confidence !== null && ` · ${confidence}% confidence`}
              </p>
              <p className="text-sm text-[var(--text-secondary)] mt-0.5">{analysis.message || cfg.blurb}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-[var(--bg-card-hover)] border border-[var(--border-subtle)]">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)] mb-1">Defect Type</p>
            <p className="font-semibold text-sm text-[var(--text-primary)] flex items-center gap-1.5">
              <FileSearch className="w-4 h-4 text-[var(--accent-cyan)] flex-shrink-0" />
              {analysis.defectType || (analysis.isPothole ? 'Pothole' : 'None')}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-[var(--bg-card-hover)] border border-[var(--border-subtle)]">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)] mb-1">Confidence</p>
            <p className="text-2xl font-bold tabular-nums text-[var(--text-primary)]">
              {confidence !== null ? `${confidence}%` : '—'}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-[var(--bg-card-hover)] border border-[var(--border-subtle)]">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)] mb-1">Evidence Quality</p>
            <p className="font-semibold text-sm" style={{ color: qualityColor }}>
              {analysis.evidenceQuality || '—'}
            </p>
          </div>
        </div>

        {analysis.description && (
          <div className="pt-4 border-t border-[var(--border-subtle)]">
            <h4 className="font-medium text-[var(--text-primary)] mb-2">AI Description</h4>
            <p className="text-sm text-[var(--text-secondary)] italic">"{analysis.description}"</p>
          </div>
        )}

        {analysis.environment && (
          <div>
            <h4 className="font-medium text-[var(--text-primary)] mb-2">Scene / Surroundings</h4>
            <p className="text-sm text-[var(--text-secondary)] italic">"{analysis.environment}"</p>
          </div>
        )}

        <p className="text-xs text-[var(--text-muted)] flex items-start gap-1.5 pt-3 border-t border-[var(--border-subtle)]">
          <Sparkles className="w-3.5 h-3.5 text-[var(--accent-cyan)] flex-shrink-0 mt-0.5" />
          Stored permanently with this complaint at report time. Persists through VERIFIED and RESOLVED.
          {analysis.analyzedAt && (
            <span className="ml-1">
              <AlertCircle className="w-3 h-3 inline -mt-0.5 mr-1" />
              {new Date(analysis.analyzedAt).toLocaleString()}
            </span>
          )}
        </p>
      </CardContent>
    </Card>
  )
}
