export type Window = { kind: string; percentUsed: number; resetsAt?: string }

/** The main loop's prompt cache and this session's cost, for the Session section. */
export type Session = {
  /** When the last main-loop request was sent (ms); the cache lifetime counts from it. */
  cacheAt: number | null
  /** That cache's lifetime in ms: 5 minutes or 1 hour. */
  cacheTtl: number
  /** Input tokens the last request was answered over (the context the next reply re-reads). */
  contextTokens: number
  /** Learned price of one uncached input token in USD; null until measured. */
  inputPrice: number | null
  /** USD: the whole session, and the last finished turn. */
  costTotal: number | null
  costLast: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-pace': {
      windows: Window[]
      now: number
      isHidden: boolean
      session: Session
      /** Away note ticked for this session (on at each new session). */
      autoHandoff: boolean
      /** When the away note last sent its prompt (ms), 0 if not since the person's last prompt. */
      handoffSentAt: number
    }
  }
}
