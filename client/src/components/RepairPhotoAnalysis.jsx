import {
  ScanLine, CheckCircle2, AlertTriangle, XCircle, RefreshCw, ShieldCheck,
  Clock3, Settings2, Ban, HelpCircle, Sparkles
} from 'lucide-react'
import { Button, ProgressBar } from './UI'

function PanelHeader({ icon: Icon, title, chip, tone }) {
  return (
    <div className={`flex items-start justify-between gap-3 px-5 py-4 border-b ${tone.header}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${tone.iconBg}`}>
          <Icon className={`w-5 h-5 ${tone.icon}`} />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">AI Proof-of-Repair</p>
          <p className={`font-semibold text-sm ${tone.title}`}>{title}</p>
        </div>
      </div>
      {chip}
    </div>
  )
}

function ConfidenceBlock({ confidence, barColor, textClass }) {
  return (
    <div className="p-3 rounded-lg bg-[var(--bg-card-hover)] border border-[var(--border-subtle)]">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)] mb-1">AI Confidence</p>
      <p className={`text-2xl font-bold tabular-nums ${textClass}`}>{confidence}%</p>
      <div className="mt-1.5">
        <ProgressBar value={confidence} max={100} showLabel={false} color={barColor} className="h-2" />
      </div>
    </div>
  )
}

function AnalyzingView({ previewUrl }) {
  return (
    <div
      className="mt-4 rounded-xl border border-[var(--accent-cyan)]/40 bg-slate-950 overflow-hidden"
      data-testid="repair-ai-analyzing"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-cyan-500/20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center">
            <ScanLine className="w-5 h-5 text-cyan-300 animate-pulse" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-400/80">AI Proof-of-Repair</p>
            <p className="font-semibold text-sm text-cyan-100">VERIFYING — proof-of-repair check in progress…</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-400/30">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-ping" />
          Live
        </span>
      </div>

      <div className="relative">
        {previewUrl && (
          <div className="relative max-h-56 overflow-hidden">
            <img src={previewUrl} alt="After-repair photo being verified" className="w-full max-h-56 object-contain bg-black/40" />
            <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/10 via-transparent to-cyan-500/10" />
            <div className="absolute inset-x-0 top-0 h-0.5 bg-cyan-400 shadow-[0_0_18px_4px_rgba(34,211,238,0.7)] animate-[scanline_2s_ease-in-out_infinite]" />
            <style>{`@keyframes scanline { 0%{top:0} 50%{top:calc(100% - 2px)} 100%{top:0} }`}</style>
          </div>
        )}
        <div className="p-5 space-y-3">
          {['Inspecting road surface', 'Checking for completed repair', 'Grading proof-of-repair'].map((step, i) => (
            <div key={step} className="flex items-center gap-3 text-sm">
              <span className="w-5 h-5 rounded-full border-2 border-cyan-400/60 border-t-transparent animate-spin flex-shrink-0" style={{ animationDelay: `${i * 0.15}s` }} />
              <span className="text-slate-300">{step}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ErrorView({ error, onRetry }) {
  const isConfig = error.code === 'GEMINI_NOT_CONFIGURED'
  const Icon = isConfig ? Settings2 : AlertTriangle
  return (
    <div
      className="mt-4 rounded-xl border border-red-300 bg-red-50 overflow-hidden"
      data-testid="repair-ai-error"
      role="alert"
    >
      <div className="flex items-start gap-3 p-5">
        <div className="w-10 h-10 rounded-lg bg-red-100 border border-red-200 flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-red-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-red-500">AI Proof-of-Repair</p>
          <p className="font-semibold text-sm text-red-800">
            {isConfig ? 'Configuration required' : 'AI verification unavailable'}
          </p>
          <p className="text-sm text-red-700/90 mt-1.5">{error.message}</p>
          {!isConfig && (
            <Button
              size="sm"
              variant="outline"
              className="mt-3 border-red-300 text-red-700 hover:bg-red-100"
              onClick={onRetry}
            >
              <RefreshCw className="w-4 h-4 mr-1.5" />
              Retry Verification
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function ResultShell({ testid, tone, icon: Icon, chip, title, result, footer }) {
  return (
    <div className={`mt-4 rounded-xl border overflow-hidden shadow-sm bg-white ${tone.border}`} data-testid={testid}>
      <PanelHeader icon={Icon} title={title} chip={chip} tone={tone} />
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ConfidenceBlock
            confidence={result.confidence}
            barColor={tone.barColor}
            textClass={tone.confidenceText}
          />
          <div className="p-3 rounded-lg bg-[var(--bg-card-hover)] border border-[var(--border-subtle)]">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)] mb-1">Verdict</p>
            <p className={`font-semibold text-sm ${tone.verdictText}`}>{tone.verdictLabel}</p>
            <p className="text-xs text-[var(--text-muted)] mt-1.5 leading-relaxed">{result.message}</p>
          </div>
        </div>
        {result.notes && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)] mb-1.5">AI Notes</p>
            <p className="text-sm italic text-[var(--text-primary)] leading-relaxed">"{result.notes}"</p>
          </div>
        )}
        {footer}
        <p className="text-xs text-[var(--text-muted)] flex items-start gap-1.5 pt-1 border-t border-[var(--border-subtle)]">
          <Sparkles className="w-3.5 h-3.5 text-[var(--accent-cyan)] flex-shrink-0 mt-0.5" />
          Checked live by Gemini before submission — the server runs this check again when you submit.
        </p>
      </div>
    </div>
  )
}

function AcceptedView({ result }) {
  return (
    <ResultShell
      testid="repair-ai-accepted"
      icon={CheckCircle2}
      result={result}
      tone={{
        border: 'border-emerald-300',
        header: 'bg-gradient-to-r from-emerald-50 to-white border-emerald-200',
        iconBg: 'bg-emerald-100 border border-emerald-200',
        icon: 'text-emerald-600',
        title: 'text-emerald-800',
        barColor: 'var(--accent-green)',
        confidenceText: 'text-emerald-600',
        verdictText: 'text-emerald-700',
        verdictLabel: 'REPAIR VISIBLE'
      }}
      chip={
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-emerald-600 text-white flex-shrink-0">
          <ShieldCheck className="w-3.5 h-3.5" />
          Accepted
        </span>
      }
      title="Photo shows completed repair work"
      footer={
        <div className="flex items-start gap-2.5 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-emerald-800">Ready to submit — this photo can be sent as repair evidence.</p>
        </div>
      }
    />
  )
}

function RejectedView({ result }) {
  return (
    <ResultShell
      testid="repair-ai-rejected"
      icon={XCircle}
      result={result}
      tone={{
        border: 'border-red-300',
        header: 'bg-gradient-to-r from-red-50 to-white border-red-200',
        iconBg: 'bg-red-100 border border-red-200',
        icon: 'text-red-600',
        title: 'text-red-800',
        barColor: 'var(--accent-red)',
        confidenceText: 'text-red-600',
        verdictText: 'text-red-700',
        verdictLabel: 'NOT A REPAIR'
      }}
      chip={
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-red-600 text-white flex-shrink-0">
          <Ban className="w-3.5 h-3.5" />
          Rejected
        </span>
      }
      title="Image does not show a completed repair"
      footer={
        <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-50 border border-red-200">
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-800">
            <strong>Submission blocked.</strong> Click the photo above to upload an image of the repaired road surface.
          </p>
        </div>
      }
    />
  )
}

function UncertainView({ result }) {
  return (
    <ResultShell
      testid="repair-ai-review"
      icon={HelpCircle}
      result={result}
      tone={{
        border: 'border-amber-300',
        header: 'bg-gradient-to-r from-amber-50 to-white border-amber-200',
        iconBg: 'bg-amber-100 border border-amber-200',
        icon: 'text-amber-600',
        title: 'text-amber-800',
        barColor: 'var(--accent-amber)',
        confidenceText: 'text-amber-600',
        verdictText: 'text-amber-700',
        verdictLabel: 'UNCERTAIN'
      }}
      chip={
        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-amber-500 text-white flex-shrink-0">
          <Clock3 className="w-3.5 h-3.5" />
          Manual Review
        </span>
      }
      title="AI could not confirm the repair"
      footer={
        <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-50 border border-amber-200">
          <Clock3 className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            You can still submit — an officer will review this photo manually.
          </p>
        </div>
      }
    />
  )
}

export default function RepairPhotoAnalysis({ state = 'idle', result, error, previewUrl, onRetry }) {
  if (state === 'idle') return null
  if (state === 'analyzing') return <AnalyzingView previewUrl={previewUrl} />
  if (state === 'error') {
    return <ErrorView error={error || { code: 'UNKNOWN', message: 'AI verification failed. Please try again.' }} onRetry={onRetry} />
  }
  if (state === 'done' && result) {
    if (result.verdict === 'REPAIR_VISIBLE') return <AcceptedView result={result} />
    if (result.verdict === 'NOT_A_REPAIR') return <RejectedView result={result} />
    return <UncertainView result={result} />
  }
  return null
}
