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
