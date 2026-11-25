import { expect, test } from 'claude-code/testing'

// The band drawn from stored values: 18 minutes into a 1-hour cache, 84k of
// context, 5h window 2 hours in (steady use 40%), week 3 days 1 hour in.
const AT = Date.parse('2026-11-25T12:00:00Z')
const HOUR = 3_600_000
const SEED: Record<string, unknown> = {
  now: AT,
  isHidden: false,
  autoHandoff: true,
  handoffSentAt: 0,
  windows: [
    { kind: 'five_hour', percentUsed: 10, resetsAt: new Date(AT + 3 * HOUR).toISOString() },
    { kind: 'seven_day', percentUsed: 82, resetsAt: new Date(AT + (7 * 24 - 73) * HOUR).toISOString() },
  ],
  session: {
    cacheAt: AT - 18 * 60_000,
    cacheTtl: HOUR,
    contextTokens: 84_000,
    inputPrice: null,
    costTotal: 2.6,
    costLast: null,
  },
}

const BAND = {
  plugin: 'usage-pace',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 140,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('the line and its hover rows draw on every surface with a band', async ($, on) => {
  on('state.get', (_, e) => {
    const value = e.plugin === 'usage-pace' ? SEED[e.key] : undefined
    // A call on `$` is answered `{ value }`: here the StateRead.
    return { value: { value, version: value === undefined ? 0 : 1 } }
  })

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })

    // The line: short labels, no pace numbers.
    expect(await ui.find({ type: 'Text', text: /^Cache 42m$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^5h 10%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Week 82%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^handoff/ })).toBeUndefined()

    // The hover rows, with live numbers.
    expect(await ui.find({ type: 'Text', text: /^Prompt cache: 42m left/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Away note: on\./ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Context: 84k of 200k tokens/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Session cost so far: \$2\.60/ })).toBeDefined()
    expect(
      await ui.find({ type: 'Text', text: /^5-hour limit: 10% used\. Steady use would be at 40% now \(grey tick\), so you are 30% under\./ }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Weekly limit: 82% used\..*so you are \d+% over\. Blue tick/ })).toBeDefined()

    await ui.unmount()
  }
})

test('the away-note box toggles off with its hover text', async ($, on) => {
  const stored: Record<string, unknown> = { ...SEED }
  on('state.get', (_, e) => {
    const value = e.plugin === 'usage-pace' ? stored[e.key] : undefined
    // A call on `$` is answered `{ value }`: here the StateRead.
    return { value: { value, version: value === undefined ? 0 : 1 } }
  })
  on('state.set', (_, e) => {
    if (e.plugin === 'usage-pace') stored[e.key] = e.value
    return { value: { isSet: true, version: 2 } }
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'away-note' })
  expect(stored.autoHandoff).toBe(false)
  await ui.unmount()
})
