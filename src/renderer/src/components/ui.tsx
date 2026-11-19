import { useEffect, useState, type ReactNode } from 'react'

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field${wide ? ' wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  )
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <header className="section-head">
        <h3>{title}</h3>
        {action}
      </header>
      {children}
    </section>
  )
}

/** Text input that only commits valid values, on Enter or when focus leaves. */
export function TextInput({ value, onChange, placeholder, validate }: { value: string; onChange: (v: string) => void; placeholder?: string; validate?: (v: string) => boolean }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const v = draft.trim()
    if (v !== value && v !== '' && (!validate || validate(v))) onChange(v)
    else setDraft(value)
  }
  return (
    <input
      className="input"
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(value)
      }}
    />
  )
}

export function NumberInput({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  unit,
  placeholder
}: {
  /** NaN shows an empty field, e.g. when several selected things have different values. */
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  placeholder?: string
}) {
  const shown = (v: number) => (Number.isFinite(v) ? String(v) : '')
  const [draft, setDraft] = useState(shown(value))
  useEffect(() => setDraft(shown(value)), [value])
  const commit = (text: string) => {
    const n = Number(text.replace(',', '.'))
    if (text.trim() !== '' && Number.isFinite(n)) {
      const clamped = Math.min(max, Math.max(min, n))
      if (clamped !== value) onChange(clamped)
      setDraft(shown(clamped))
    } else setDraft(shown(value))
  }
  const nudge = (dir: number, big: boolean) => {
    const next = Math.min(max, Math.max(min, +((Number.isFinite(value) ? value : 0) + dir * step * (big ? 10 : 1)).toFixed(6)))
    if (next !== value) onChange(next)
  }
  return (
    <span className="number">
      <input
        className="input"
        inputMode="decimal"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            nudge(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey)
          }
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </span>
  )
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step,
  unit,
  format
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  unit?: string
  format?: (v: number) => string
}) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <span className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output>
        {format ? format(value) : +value.toFixed(2)}
        {unit ? ` ${unit}` : ''}
      </output>
    </span>
  )
}

const SWATCHES = ['#ffffff', '#ff2a1f', '#ff7a1a', '#ffd000', '#3ddc5a', '#18b6ff', '#2d4bff', '#8a2bff', '#ff2d9a', '#000000']

export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span className="color">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Pick colour" />
      <span className="swatches">
        {SWATCHES.map((c) => (
          <button key={c} className={c === value.toLowerCase() ? 'on' : ''} style={{ background: c }} title={c} onClick={() => onChange(c)} />
        ))}
      </span>
    </span>
  )
}

export function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button className={`toggle${value ? ' on' : ''}`} role="switch" aria-checked={value} onClick={() => onChange(!value)}>
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
      {label}
    </button>
  )
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
/** Note name as Reaper shows it by default (note 60 = C4). */
export const noteName = (note: number): string => `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`

export const isIPv4 = (v: string): boolean => /^(\d{1,3})(\.\d{1,3}){3}$/.test(v) && v.split('.').every((n) => Number(n) <= 255)

/** Note values as lengths in beats (quarter notes), in 4/4. T = triplet, a dot = one and a half times as long. */
const NOTE_VALUES: { beats: number; label: string }[] = [
  { beats: 16, label: '4 bars' },
  { beats: 8, label: '2 bars' },
  { beats: 4, label: '1 bar' },
  { beats: 3, label: '1/2.' },
  { beats: 2, label: '1/2' },
  { beats: 1.5, label: '1/4.' },
  { beats: 4 / 3, label: '1/2T' },
  { beats: 1, label: '1/4' },
  { beats: 0.75, label: '1/8.' },
  { beats: 2 / 3, label: '1/4T' },
  { beats: 0.5, label: '1/8' },
  { beats: 1 / 3, label: '1/8T' },
  { beats: 0.25, label: '1/16' },
  { beats: 1 / 6, label: '1/16T' },
  { beats: 0.125, label: '1/32' }
]

/** A length in beats as its note value, e.g. "1/8T", or in beats if it is none. */
export function beatLabel(beats: number): string {
  return NOTE_VALUES.find((n) => Math.abs(n.beats - beats) < 1e-3)?.label ?? `${+beats.toFixed(3)} beats`
}

/**
 * A length in beats, chosen as a note value (1/4, 1/8T, 1 bar …) or typed in beats. Wherever
 * something runs in the tempo of the song.
 */
export function BeatLength({ value, onChange, min = 1 / 16, max = 64 }: { value: number; onChange: (beats: number) => void; min?: number; max?: number }) {
  const known = NOTE_VALUES.find((n) => Math.abs(n.beats - value) < 1e-3)
  const [custom, setCustom] = useState(!known)
  const typing = custom || !known
  return (
    <span className="beat-length">
      <select
        className="input"
        aria-label="Note value"
        value={typing ? 'custom' : String(known.beats)}
        onChange={(e) => {
          setCustom(e.target.value === 'custom')
          if (e.target.value !== 'custom') onChange(Number(e.target.value))
        }}
      >
        {NOTE_VALUES.filter((n) => n.beats >= min - 1e-6 && n.beats <= max).map((n) => (
          <option key={n.label} value={String(n.beats)}>
            {n.label}
          </option>
        ))}
        <option value="custom">Beats…</option>
      </select>
      {typing && <NumberInput value={+value.toFixed(4)} min={min} max={max} step={0.25} unit="beats" onChange={onChange} />}
    </span>
  )
}
