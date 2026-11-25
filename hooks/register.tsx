import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Session, Window } from '../types'

const windows = atom({ plugin: 'usage-pace', key: 'windows' } as const, [] as Window[])
const now = atom({ plugin: 'usage-pace', key: 'now' } as const, 0)
const isHidden = atom({ plugin: 'usage-pace', key: 'isHidden' } as const, false)
const EMPTY_SESSION: Session = {
  cacheAt: null,
  cacheTtl: 3_600_000,
  contextTokens: 0,
  inputPrice: null,
  costTotal: null,
  costLast: null,
}
const session = atom({ plugin: 'usage-pace', key: 'session' } as const, EMPTY_SESSION)
const autoHandoff = atom({ plugin: 'usage-pace', key: 'autoHandoff' } as const, true)
const handoffSentAt = atom({ plugin: 'usage-pace', key: 'handoffSentAt' } as const, 0)

// Away note (the ☒ next to the cache time; `autoHandoff` in the store): with the
// 1-hour cache, once the session has sat idle until 5 minutes are left, one
// prompt runs the handoff skill while the cache is still cheap to read. Once per
// stretch away: the person's next prompt re-arms it.
const HANDOFF_LEAD_MS = 5 * 60_000
const HANDOFF_PROMPT =
  'Away note (usage-pace mod): the person has been away for almost an hour and the prompt cache ' +
  'expires in 5 minutes. Use the usage-pace:handoff skill now. Do not ask questions; the person is away.'
// Prompts that close a session and write their own handoff: no away note after them.
const CLOSING = /^\s*\/?(end[\s_-]?session|checkpoint|handoff|usage-pace:handoff)\b/i

// Context bar: 100% = 200k tokens, where a conversation is too heavy (every
// reply re-reads all of it). Conversations start near 70k of standing
// instructions; green to 110k, yellow to 150k (where the checkpoint reminder
// fires), red past it.
const CONTEXT_FULL = 200_000
const CONTEXT_YELLOW = 110_000
const CONTEXT_RED = 150_000
const contextLevel = (t: number) => (t >= CONTEXT_RED ? 'error' : t >= CONTEXT_YELLOW ? 'warning' : 'success')
const kTokens = (t: number) => `${Math.round(t / 1000)}k`
// Box width numbers are text cells (~6 px on desktop): 12 cells ≈ 70 px.
const CONTEXT_BAR_CELLS = 12

const HOUR = 3_600_000
const LENGTHS: Record<string, { ms: number; label: string }> = {
  seven_day: { ms: 7 * 24 * HOUR, label: 'Week' },
  five_hour: { ms: 5 * HOUR, label: '5h' },
}
const ORDER = ['five_hour', 'seven_day']
// Shares of the line, left to right: session, 5-hour, week.
const SHARE: Record<string, number> = { five_hour: 1.3, seven_day: 2 }
// The session section is sized to its text; the 5h and week sections share what's left.

const clamp = (n: number) => Math.max(0, Math.min(100, n))
const money = (usd: number) => (usd >= 10 ? `$${usd.toFixed(1)}` : `$${usd.toFixed(2)}`)
const timeLeft = (ms: number) => (ms >= 60_000 ? `${Math.ceil(ms / 60_000)}m` : `${Math.ceil(ms / 1000)}s`)

/** Where even use would be right now, 0–100, from the window's reset time. */
export function pacePercent(w: Window, at: number): number | null {
  const len = LENGTHS[w.kind]
  if (!len || !w.resetsAt) return null
  const end = Date.parse(w.resetsAt)
  if (!Number.isFinite(end)) return null
  return clamp(((at - (end - len.ms)) / len.ms) * 100)
}

/**
 * Week only: where the pace marker will be after 8 idle hours (a night's sleep).
 * If usage sits at or below it, stopping now means tomorrow starts on track.
 */
const RECOVERY_MS = 8 * HOUR
export function recoveryPercent(w: Window, at: number): number | null {
  if (w.kind !== 'seven_day') return null
  const p = pacePercent(w, at + RECOVERY_MS)
  return p === null || p >= 100 ? null : p
}

type Marker = { at: number; kind: 'pace' | 'recovery' }

/**
 * Colour from the gap to even pace, not from total use:
 * green up to 2% over pace; yellow from there up to the 8-hour recovery tick;
 * red past it. The 5-hour window has no recovery tick: yellow up to 15% over.
 * In the week's last 8 hours there is no tick either: yellow to the end.
 */
const SLACK = 2
const FIVE_HOUR_RED = 15
export function paceLevel(kind: string, used: number, pace: number | null, recovery: number | null) {
  if (pace === null || used - pace <= SLACK) return 'success'
  const limit = kind === 'five_hour' ? pace + FIVE_HOUR_RED : (recovery ?? 100)
  return used <= limit ? 'warning' : 'error'
}

// The latest rate-limit reading, shared by every session through $.store, so
// a session's bar moves when another chat uses the limits.
const SHARED_KEY = 'latestLimits'
type SharedLimits = { at: number; rateLimits: Window[] }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function formatReset(iso: string | undefined, kind: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const h = d.getHours()
  const time = `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
  return kind === 'five_hour' ? time : `${DAYS[d.getDay()]} ${time}`
}

type CostReader = { session: { usage: () => Promise<{ cost?: { usd: number } }> } }
async function readCost($: CostReader): Promise<number | null> {
  try {
    return (await $.session.usage()).cost?.usd ?? null
  } catch {
    return null
  }
}

// When the windows shown were read (0 = never); a newer shared reading replaces them.
let windowsAt = 0

async function shareLimits($: EngineInterface, rateLimits: Window[]) {
  windowsAt = Date.now()
  try {
    await $.store.set(SHARED_KEY, { at: windowsAt, rateLimits } satisfies SharedLimits)
  } catch {
    // the bar still works from this session's own readings
  }
}

async function pullShared($: EngineInterface) {
  try {
    const s = (await $.store.get(SHARED_KEY)) as SharedLimits | undefined
    if (s && s.at > windowsAt && s.rateLimits?.length) {
      windowsAt = s.at
      await update($, windows, () => s.rateLimits.map(r => ({ ...r })))
    }
  } catch {
    // nothing shared yet
  }
}

/** A window whose reset time has passed is over: its reading no longer applies. */
const isLive = (w: Window, at: number) => !w.resetsAt || !(Date.parse(w.resetsAt) <= at)
/** A window as drawn: a reading, or a stand-in (0% past its reset, '–' never read). */
type Shown = Window & { isUnknown?: boolean }

// Hover text. Each item on the line joins a hover group (`scope`); the band
// holds one hidden row per group above the line, shown while the pointer is on
// that item or on the row itself. The line never moves and nothing is covered.
// Surfaces without a pointer (the terminal's main screen, phones) never show them.
const tipScope = (item: string) => `usage-pace-${item}`

function cacheTip(s: Session, at: number): string {
  if (s.cacheAt === null) return 'Prompt cache: starts with the first reply.'
  const left = s.cacheAt + s.cacheTtl - at
  const life = s.cacheTtl >= HOUR ? 'an hour' : '5 minutes'
  return left > 0
    ? `Prompt cache: ${timeLeft(left)} left (it lasts ${life} after each reply). Reply before then and the ` +
        'conversation is re-read cheaply; once cold, the next reply costs more than 10 times as much to load it.'
    : 'Prompt cache: cold. The next reply loads the whole conversation again at full cost; a fresh session may be cheaper.'
}

function awayTip(isOn: boolean, sentAt: number): string {
  const what = "if you're away and the cache has 5 minutes left, Claude writes a short handoff note (nothing is committed)"
  if (!isOn) return `Away note: off. Click to turn on: ${what}.`
  if (sentAt) return 'Away note: done for this time away (or you closed the session yourself). Your next message re-arms it. Click to turn off.'
  return `Away note: on. ${what[0]!.toUpperCase()}${what.slice(1)}. Click to turn off.`
}

const contextTip = (tokens: number) =>
  `Context: ${kTokens(tokens)} of ${kTokens(CONTEXT_FULL)} tokens. Every reply re-reads all of it. ` +
  `Yellow from ${kTokens(CONTEXT_YELLOW)}, red from ${kTokens(CONTEXT_RED)}: time for a fresh session.`

const costTip = (usd: number) =>
  `Session cost so far: ${money(usd)}, estimated at API list prices. Not billed on a subscription; it shows how heavy the session is.`

function windowTip(w: Shown, at: number): string {
  const name = w.kind === 'five_hour' ? '5-hour limit' : w.kind === 'seven_day' ? 'Weekly limit' : w.kind
  if (w.isUnknown) return `${name}: no reading yet. It shows after the next reply.`
  if (!w.resetsAt) return `${name}: reset. The next window starts with your next message.`
  const used = clamp(w.percentUsed)
  const reset = ` Resets ${formatReset(w.resetsAt, w.kind)}.`
  const pace = pacePercent(w, at)
  if (pace === null) return `${name}: ${used}% used.${reset}`
  const diff = Math.round(used - pace)
  const where = diff === 0 ? 'on pace' : diff > 0 ? `${diff}% over` : `${-diff}% under`
  let tip = `${name}: ${used}% used. Steady use would be at ${Math.round(pace)}% now (grey tick), so you are ${where}.`
  if (recoveryPercent(w, at) !== null) {
    tip += ' Blue tick: where steady use will be in 8 hours; at or left of it, a night off gets you back on track.'
  }
  return `${tip} Colour: green on pace, yellow over, red far over.${reset}`
}

// This session's own reading as last seen (JSON). Only a change to it is news.
// Comparing with what's shown instead made sessions with different readings
// (one stale from before a reset) overwrite each other every 15 s.
let lastOwn = ''

/**
 * This session's own latest reading (the status line's), shown and shared
 * only when it has changed since this session last saw it. At session start
 * (`isStart`) an existing shared reading wins: the own one may be from before
 * the person was away.
 */
async function pullOwn($: EngineInterface, isStart = false) {
  try {
    const own = (await $.session.usage()).rateLimits.map(r => ({ ...r }))
    if (!own.length) return
    const json = JSON.stringify(own)
    if (json === lastOwn) return
    lastOwn = json
    if (isStart && windowsAt > 0) return
    await update($, windows, () => own)
    await shareLimits($, own)
  } catch {
    // no reading yet
  }
}

/** The context size as the status line has it; catches /compact and /clear between replies. */
async function pullContext($: EngineInterface) {
  try {
    const t = (await $.session.usage()).context.tokens
    if (t === undefined) return
    const s = await read($, session)
    if (s.contextTokens !== t) await update($, session, v => ({ ...v, contextTokens: t }))
  } catch {
    // no reading yet
  }
}

// Update check: once a day, compare this copy's version with the one on GitHub.
const REPO = 'H438Design/usage-pace'
const UPDATE_CHECK_KEY = 'lastUpdateCheck'
const DAY = 24 * HOUR
const newer = (a: string, b: string) => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}
async function checkForUpdate($: EngineInterface) {
  try {
    const last = Number((await $.store.get(UPDATE_CHECK_KEY)) ?? 0)
    if (Date.now() - last < DAY) return
    await $.store.set(UPDATE_CHECK_KEY, Date.now())
    const mine = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)).version as string
    const res = await $.http.fetch(`https://raw.githubusercontent.com/${REPO}/main/.claude-plugin/plugin.json`)
    if (!res.ok) return
    const latest = JSON.parse(res.text).version as string
    if (latest && mine && newer(latest, mine)) {
      $.ui.toast(`usage-pace ${latest} is available (you have ${mine}). Update: claude plugin update usage-pace`)
    }
  } catch {
    // offline or blocked: try again tomorrow
  }
}

export const register: Register = on => {
  let turnStartCost: number | null = null
  // A turn is running (no away note while busy).
  let isBusy = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-bar',
      description: 'Show or hide the usage bar above the prompt',
    })
    await update($, now, () => Date.now())
    try {
      const u = await $.session.usage()
      await update($, session, s => ({
        ...s,
        costTotal: u.cost?.usd ?? s.costTotal,
        contextTokens: u.context.tokens ?? s.contextTokens,
      }))
    } catch {
      // no reading yet; session.measure fills it after the first reply
    }
    // Start from the newest reading any session shared, else this session's own.
    await pullShared($)
    await pullOwn($, true)
    void checkForUpdate($)
    // Move the markers with the clock, and pick up readings this session's
    // status line or other chats made since.
    $.clock.every(15_000, async () => {
      await pullOwn($)
      await pullShared($)
      await pullContext($)
      const t = await update($, now, () => Date.now())
      // Away note: ticked, idle, 1-hour cache still warm with 5 minutes or less left, not yet sent.
      if (isBusy || !(await read($, autoHandoff)) || (await read($, handoffSentAt))) return
      const s = await read($, session)
      if (s.cacheAt === null || s.cacheTtl !== HOUR) return
      const left = s.cacheAt + s.cacheTtl - t
      if (left <= 0 || left > HANDOFF_LEAD_MS) return
      await update($, handoffSentAt, () => t)
      void $.prompt.submit({ text: HANDOFF_PROMPT })
    })
    return next(e)
  })

  on('command.run', { command: 'usage-bar' }, async $ => {
    const hidden = await update($, isHidden, v => !v)
    return { text: hidden ? 'Usage bar hidden.' : 'Usage bar shown.' }
  })

  on('session.measure', async ($, e, next) => {
    if (e.rateLimits.length) {
      const fresh = e.rateLimits.map(r => ({ ...r }))
      lastOwn = JSON.stringify(fresh)
      await update($, windows, () => fresh)
      await shareLimits($, fresh)
    }
    if (e.cost) await update($, session, s => ({ ...s, costTotal: e.cost?.usd ?? s.costTotal }))
    await update($, now, () => Date.now())
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    isBusy = true
    turnStartCost = await readCost($)
    // The person is back: arm the away note again for their next time away,
    // unless they are closing the session themselves (end session, checkpoint):
    // that writes the handoff already, so the away note counts as done.
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
      const isClosing = CLOSING.test(e.text) || CLOSING.test(e.command?.name ?? '')
      await update($, handoffSentAt, () => (isClosing ? Date.now() : 0))
    }
    return next(e)
  })
  // Main-loop requests only: when each went out (the cache lifetime counts from
  // there), the lifetime it wrote, the context size, and a learned input price
  // from Claude's price ratios (output 5x, cache read 0.1x, writes 1.25x/2x).
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    const sentAt = Date.now()
    const before = await readCost($)
    const r = yield* next(e)
    const u = r?.usage
    if (u) {
      const after = await readCost($)
      const w5 = u.ephemeral_5m_input_tokens ?? 0
      const w1 = u.ephemeral_1h_input_tokens ?? 0
      const writes = w5 + w1 > 0 ? 1.25 * w5 + 2 * w1 : 1.25 * u.cache_creation_input_tokens
      const weighted = u.input_tokens + 0.1 * u.cache_read_input_tokens + writes + 5 * u.output_tokens
      const spent = before !== null && after !== null ? after - before : 0
      await update($, session, s => ({
        ...s,
        cacheAt: sentAt,
        cacheTtl: w1 > 0 ? HOUR : w5 > 0 ? 300_000 : s.cacheTtl,
        contextTokens: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
        inputPrice: spent > 0 && weighted > 0 ? spent / weighted : s.inputPrice,
        costTotal: after ?? s.costTotal,
      }))
      await update($, now, () => Date.now())
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    isBusy = false
    const total = await readCost($)
    if (total !== null) {
      const start = turnStartCost
      await update($, session, s => ({
        ...s,
        costTotal: total,
        costLast: start !== null ? total - start : s.costLast,
      }))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    const at = (await read($, now)) || Date.now()
    // Both windows always show. A window past its reset shows 0% (the next one
    // starts with the next reply, which brings a new reading); one never read
    // yet shows '–'. Hiding them made the 5h section vanish while away and be
    // missing at startup until the first reply.
    const readings = await read($, windows)
    const list: Shown[] = ORDER.map(kind => {
      const w = readings.find(r => r.kind === kind)
      if (w && isLive(w, at)) return w
      return { kind, percentUsed: 0, isUnknown: !w }
    })
    const sess = await read($, session)
    const hasSession = sess.cacheAt !== null || sess.costTotal !== null

    const isAuto = await read($, autoHandoff)
    const sentAt = await read($, handoffSentAt)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const isTerminal = e.surface === 'terminal'
    const hasSvg = !isTerminal && 'Svg' in ui

    // Hover rows, one per item, hidden until the pointer is on that item.
    const tips: { item: string; text: string }[] = []
    if (hasSession) {
      tips.push({ item: 'cache', text: cacheTip(sess, at) }, { item: 'away', text: awayTip(isAuto, sentAt) })
      if (sess.contextTokens > 0) tips.push({ item: 'context', text: contextTip(sess.contextTokens) })
      if (sess.costTotal !== null) tips.push({ item: 'cost', text: costTip(sess.costTotal) })
    }
    for (const w of list) tips.push({ item: w.kind, text: windowTip(w, at) })

    // Session: cache time (green, blue once cold) with the away-note toggle,
    // then the context size and bar, then the session's total cost.
    const sessionCell = (s: Session) => {
      const leftMs = s.cacheAt === null ? 0 : s.cacheAt + s.cacheTtl - at
      const isCold = leftMs <= 0

      // Context: the number, then a short bar out of CONTEXT_FULL.
      const ctx = s.contextTokens
      const ctxLevel = contextLevel(ctx)
      const ctxUsed = clamp((ctx / CONTEXT_FULL) * 100)
      const ctxBar = hasSvg ? (
        <ui.Svg
          source={svgBar(ctxUsed, [], SVG_COLORS[ctxLevel] ?? WARM, BAR)}
          alt={`Context: ${kTokens(ctx)} of ${kTokens(CONTEXT_FULL)} tokens`}
          height={BAR.height}
        />
      ) : (
        terminalBar(Box, ctxUsed, [], ctxLevel)
      )

      return (
        <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
          {/* Cache time and its away-note toggle sit together, no gap. */}
          <Box flexDirection="row" alignItems="center" columnGap={0} flexShrink={0}>
            <Box flexShrink={0} hover={{ scope: tipScope('cache') }}>
              <Text size="caption">
                <Text weight="semibold">Cache</Text>{' '}
                <Text tabular color={isCold ? 'ide' : 'success'}>
                  {s.cacheAt === null ? '–' : isCold ? 'cold' : timeLeft(leftMs)}
                </Text>
              </Text>
            </Box>
            <Box flexShrink={0} hover={{ scope: tipScope('away') }}>
              <Button
                key="away-note"
                plain
                dimColor={!isAuto}
                onPress={() => void update($, autoHandoff, v => !v)}
              >
                <Text size="heading">{isAuto ? ' ☒' : ' ☐'}</Text>
                <Text size="caption">{sentAt ? '✓' : ''}</Text>
              </Button>
            </Box>
          </Box>
          {ctx > 0 && (
            <Box
              flexDirection="row"
              alignItems="center"
              columnGap={1}
              flexShrink={0}
              hover={{ scope: tipScope('context') }}
            >
              <Text size="caption">
                <Text weight="semibold">Ctx</Text>{' '}
                <Text tabular color={ctxLevel}>
                  {kTokens(ctx)}
                </Text>
              </Text>
              <Box width={CONTEXT_BAR_CELLS} flexShrink={0}>
                {ctxBar}
              </Box>
            </Box>
          )}
          {s.costTotal !== null && (
            <Box flexShrink={0} hover={{ scope: tipScope('cost') }}>
              <Text size="caption" tabular dimColor>
                {money(s.costTotal)}
              </Text>
            </Box>
          )}
        </Box>
      )
    }

    const cell = (w: Shown) => {
      const used = clamp(w.percentUsed)
      const pace = pacePercent(w, at)
      const recovery = recoveryPercent(w, at)
      const level = paceLevel(w.kind, used, pace, recovery)
      const label = LENGTHS[w.kind]?.label ?? w.kind
      // + means ahead of even pace (using faster), - means behind. Kept on the
      // line until the hover rows are seen working on the desktop app.
      const gap = pace === null ? 0 : Math.round(used - pace)
      const paceText = pace === null ? '' : gap === 0 ? ' ±0%' : ` ${gap > 0 ? '+' : '-'}${Math.abs(gap)}%`
      const markers: Marker[] = []
      if (pace !== null) markers.push({ at: pace, kind: 'pace' })
      if (recovery !== null) markers.push({ at: recovery, kind: 'recovery' })

      const bar = hasSvg ? (
        <ui.Svg
          source={svgBar(used, markers, SVG_COLORS[level] ?? WARM, BAR)}
          alt={alt(label, used, pace, recovery)}
          height={BAR.height}
        />
      ) : (
        terminalBar(Box, used, markers, level)
      )

      // One section per window: text, then the bar filling the rest, then the reset time.
      return (
        <Box
          flexDirection="row"
          alignItems="center"
          columnGap={1}
          flexGrow={SHARE[w.kind] ?? 1}
          width={0}
          hover={{ scope: tipScope(w.kind) }}
        >
          <Box flexShrink={0}>
            <Text size="caption" wrap="truncate-end">
              <Text weight="semibold">{label}</Text>{' '}
              <Text tabular>{w.isUnknown ? '–' : `${used}%`}</Text>
              <Text tabular color={level}>{paceText}</Text>
            </Text>
          </Box>
          <Box flexGrow={1} width={0}>
            {bar}
          </Box>
          <Box flexShrink={0}>
            <Text size="caption" dimColor>
              {formatReset(w.resetsAt, w.kind)}
            </Text>
          </Box>
        </Box>
      )
    }

    // The hover rows sit above the line, so showing one never moves the item
    // under the pointer; a row stays while the pointer is on it too.
    return (
      <Box flexDirection="column" width="100%">
        {tips.map(t => (
          <Box display="none" hover={{ scope: tipScope(t.item), display: 'flex' }}>
            <Text size="caption" wrap="wrap">
              {t.text}
            </Text>
          </Box>
        ))}
        <Box flexDirection="row" columnGap={3} width="100%">
          {hasSession && sessionCell(sess)}
          {list.map(cell)}
        </Box>
      </Box>
    )
  })
}

// Fixed colours: the SVG is drawn as an image and can't read the theme.
const WARM = '#3FA66B'
const COLD = '#4A90D9'
const SVG_COLORS: Record<string, string> = { success: WARM, warning: '#D9A13B', error: '#D9534F' }

/**
 * A rounded bar that stretches to its slot. The viewBox is stretched
 * (preserveAspectRatio="none"); strokes use non-scaling-stroke so the round
 * caps stay true half-circles at any width.
 */
type BarSize = { height: number; stroke: number }
const BAR: BarSize = { height: 8, stroke: 5 }

const alt = (label: string, used: number, pace: number | null, recovery: number | null) =>
  `${label}: ${used}% used${pace === null ? '' : `, even pace ${Math.round(pace)}%`}` +
  (recovery === null ? '' : `, after 8 idle hours ${Math.round(recovery)}%`)

// Pace tick grey and solid; the 8-hour recovery tick blue and dashed.
const MARKER_SVG: Record<Marker['kind'], string> = {
  pace: 'stroke="#9AA0A6" stroke-width="2"',
  recovery: `stroke="${COLD}" stroke-width="2" stroke-dasharray="2 1.5"`,
}

function svgBar(filled: number, markers: Marker[], fill: string, size: BarSize): string {
  const { height: h, stroke } = size
  const x = (p: number) => (p * 10).toFixed(1)
  const line = (from: number, to: number, color: string, width: number) =>
    `<line x1="${x(from)}" y1="${h / 2}" x2="${x(to)}" y2="${h / 2}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`
  const parts = [line(0, 100, '#8888884D', stroke)]
  if (filled > 0) parts.push(line(0, filled, fill, stroke))
  // The ticks span the full height, so they stand out above and below the bar.
  for (const m of markers) {
    parts.push(
      `<line x1="${x(m.at)}" y1="0" x2="${x(m.at)}" y2="${h}" ${MARKER_SVG[m.kind]} vector-effect="non-scaling-stroke"/>`,
    )
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${h}" viewBox="-15 0 1030 ${h}" preserveAspectRatio="none">${parts.join('')}</svg>`
}

/** The terminal has no SVG: a one-row bar of coloured cells with 1-cell markers. */
const MARKER_CELL: Record<Marker['kind'], string> = { pace: 'text', recovery: 'ide' }
function terminalBar(Box: any, used: number, markers: Marker[], level: string) {
  type Seg = { grow: number; color: string } | { marker: Marker['kind'] }
  const sorted = [...markers].sort((a, b) => a.at - b.at)
  // Cut points: the fill edge and each marker; colour each stretch by whether it lies below the fill.
  const cuts = [...new Set([0, used, ...sorted.map(m => m.at), 100])].sort((a, b) => a - b)
  const segs: Seg[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i]!
    const to = cuts[i + 1]!
    for (const m of sorted) if (m.at === from && from !== 0) segs.push({ marker: m.kind })
    if (to > from) segs.push({ grow: to - from, color: to <= used ? level : 'subtle' })
  }
  return (
    <Box flexDirection="row" width="100%" height={1}>
      {segs.map((s, i) =>
        'marker' in s ? (
          <Box key={`m${i}`} width={1} flexShrink={0} height={1} backgroundColor={MARKER_CELL[s.marker]} />
        ) : (
          <Box key={`s${i}`} width={0} flexGrow={Math.max(s.grow, 0)} height={1} backgroundColor={s.color} />
        ),
      )}
    </Box>
  )
}
