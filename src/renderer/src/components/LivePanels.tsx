import type { TimingStats } from '@shared/types'
import { useStore } from '../store'
import { noteName, Section } from './ui'

export function LookPads() {
  const looks = useStore((s) => s.show.looks)
  const chasers = useStore((s) => s.show.chasers)
  const active = useStore((s) => s.status?.active)
  const running = useStore((s) => s.status?.chasers)
  const anyActive = (active?.length ?? 0) > 0 || (running?.length ?? 0) > 0
  const toggle = (id: string) => window.heavy.send({ type: 'toggle', id })

  return (
    <div className="pads-dock">
      <div className="pad-groups">
        {chasers.length > 0 && (
          <>
            <h3 className="pads-title">Chasers</h3>
            <div className="pads">
              {chasers.map((c) => {
                const run = running?.find((r) => r.chaserId === c.id)
                const level = run?.level ?? 0
                return (
                  <button key={c.id} className={`pad${run ? ' on' : ''}`} style={{ '--look': c.color, '--level': Math.min(1, level) } as React.CSSProperties} onClick={() => toggle(c.id)}>
                    <span className="pad-beam" />
                    <span className="pad-name">{c.name}</span>
                    <span className="pad-note">
                      {run ? `Step ${run.step + 1} of ${c.steps.length}` : `${c.midi ? noteName(c.midi.note) : 'No note'}, ${c.bpm} bpm`}
                    </span>
                  </button>
                )
              })}
            </div>
            <h3 className="pads-title">Looks</h3>
          </>
        )}
        <div className="pads">
          {looks.map((l) => {
            const level = active?.find((a) => a.lookId === l.id)?.level ?? 0
            const on = level > 0
            return (
              <button key={l.id} className={`pad${on ? ' on' : ''}`} style={{ '--look': l.color, '--level': Math.min(1, level) } as React.CSSProperties} onClick={() => toggle(l.id)}>
                <span className="pad-beam" />
                <span className="pad-name">{l.name}</span>
                <span className="pad-note">{l.midi ? noteName(l.midi.note) : 'No note'}</span>
              </button>
            )
          })}
          {looks.length === 0 && <p className="empty">No looks yet. Build some in the Looks tab, then play them here.</p>}
        </div>
      </div>
      <button className="button ghost release" disabled={!anyActive} title="Stop every look and chaser (Esc)" onClick={() => window.heavy.send({ type: 'releaseAll' })}>
        Release all
      </button>
    </div>
  )
}

function Timing({ label, stats, explain }: { label: string; stats: TimingStats | undefined; explain: string }) {
  const peak = Math.max(1, ...(stats?.buckets ?? []))
  return (
    <div className="timing" title={explain}>
      <div className="timing-head">
        <span>{label}</span>
        <strong>{stats && stats.count ? `${stats.p50.toFixed(2)} ms` : 'No data yet'}</strong>
      </div>
      <div className="histogram" aria-hidden>
        {(stats?.buckets ?? []).map((n, i) => (
          <span key={i} style={{ height: `${(n / peak) * 100}%` }} className={n ? '' : 'zero'} />
        ))}
      </div>
      {stats && stats.count > 0 && (
        <div className="timing-foot">
          <span>typical {stats.p50.toFixed(2)}</span>
          <span>99% under {stats.p99.toFixed(2)}</span>
          <span>worst {stats.max.toFixed(2)} ms</span>
        </div>
      )}
    </div>
  )
}

export function SignalPanel() {
  const status = useStore((s) => s.status)
  const log = useStore((s) => s.midiLog)
  const looks = useStore((s) => s.show.looks)
  const chasers = useStore((s) => s.show.chasers)

  const lookFor = (note: number, channel: number) => [...looks, ...chasers].filter((l) => l.midi && l.midi.note === note && (l.midi.channel === 0 || l.midi.channel === channel)).map((l) => l.name)

  return (
    <aside className="panel right">
      <Section title="MIDI in">
        {status && (
          <ul className="plain">
            {status.virtualPort && (
              <li>
                <strong>{status.virtualPort}</strong> <span className="muted">virtual port, select it as MIDI output in Reaper</span>
              </li>
            )}
            {status.midiPorts.map((p) => (
              <li key={p}>{p}</li>
            ))}
            {!status.virtualPort && status.midiPorts.length === 0 && <li className="muted">No MIDI input found. On Windows, create a port with loopMIDI and send to it from Reaper.</li>}
          </ul>
        )}
        <ul className="midi-log">
          {log.length === 0 && <li className="muted">Notes appear here as they arrive.</li>}
          {log.slice(0, 8).map((e, i) => {
            const names = e.kind === 'cc' ? [] : lookFor(e.note, e.channel)
            return (
              <li key={`${e.time}-${i}`} className={e.kind}>
                <span className="midi-kind">{e.kind === 'noteon' ? 'On' : e.kind === 'noteoff' ? 'Off' : 'CC'}</span>
                <span>{e.kind === 'cc' ? `#${e.note}` : `${noteName(e.note)} (${e.note})`}</span>
                <span className="muted">ch {e.channel}</span>
                <span className="midi-look">{names.join(', ')}</span>
              </li>
            )
          })}
        </ul>
      </Section>

      <Section title="Timing">
        <Timing label="Note to network" stats={status?.latency} explain="Time from receiving a MIDI note to handing the last Art-Net packet to the operating system." />
        <Timing label="Frame timing" stats={status?.jitter} explain="How late each output frame was sent compared with its schedule." />
        <p className="summary">
          {status ? `${status.fps.toFixed(0)} frames/s, ${status.packetsPerSecond.toFixed(0)} packets/s` : 'Waiting for the engine…'}
        </p>
      </Section>

      <Section title="Art-Net targets">
        {status?.targets.length === 0 && <p className="empty">Nothing to send to yet.</p>}
        <ul className="targets">
          {status?.targets.map((t) => (
            <li key={`${t.host}-${t.universe}`} className={t.error ? 'bad' : ''} title={t.error ?? undefined}>
              <span className={`dot${t.error ? ' bad' : status.output ? ' ok' : ''}`} />
              <span>{t.host}</span>
              <span className="muted">
                universe {t.universe}, {t.channels} ch
              </span>
            </li>
          ))}
        </ul>
        {status?.targets.find((t) => t.error) && <p className="error">{status.targets.find((t) => t.error)!.error}</p>}
        {status?.warnings.map((w) => (
          <p key={w} className="error">
            {w}
          </p>
        ))}
      </Section>
    </aside>
  )
}
