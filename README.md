# usage-pace

A Claude Code mod: one line above the prompt that tells you whether you're using your subscription limits too fast, and when your prompt cache goes cold.

```
Cache 42m  ☒ handoff  $0.20 · $2.60      5h 10% -4%  ▬▬▬▬|▬▬▬▬▬▬▬  4:30 PM      Week 82% +3%  ▬▬▬▬▬▬▬▬|¦▬  Wed 11:00 PM
```

- **Cache**: minutes left on the prompt cache (green), `cold` (blue) once it expired. Then last turn · session total, in USD.
- **5h / Week**: % used, then how far ahead (`+`) or behind (`-`) even, time-based use you are. The bar runs from the last reset to the next; the grey tick is even pace right now.
- **Recovery tick (week only)**: the blue dashed tick is where even pace will be 8 hours from now. If your fill is at or left of it, stopping for the night gets you back on track by morning.
- **Colours** follow pace, not total use: green up to 2% over pace, yellow up to the recovery tick, red past it. The 5-hour bar has no recovery tick and goes red at 15% over pace.
- **☒ handoff** (on by default, click to toggle): when the session has been idle and the 1-hour cache has 5 minutes left, the mod asks Claude to write a short handoff note while the cache is still cheap to read. Once per time away; your next message re-arms it. It uses the project's own handoff format when the project defines one (writing only the note, never committing or pushing), otherwise `handoffs/<topic>.md` or `HANDOFF.md`.
- Every session shares its latest limit reading, so open sessions update when you use Claude Code elsewhere.
- `/usage-bar` hides or shows the line.

## Install

In a terminal Claude Code session:

```
/plugin install usage-pace --marketplace H438Design/usage-pace
```

Or from a shell:

```
claude plugin install usage-pace --marketplace H438Design/usage-pace
```

Answer `y` to add the marketplace, then choose the **user** scope so it runs in every session, including the desktop app's Code tab.

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `H438Design/usage-pace`, then Add plugin.

Update: `claude plugin update usage-pace`. Turn off / on: `claude plugin disable usage-pace` / `claude plugin enable usage-pace`.

## Notes

- Built against Claude Code 2.1.326. The mod API is early access and may change.
- Shows limits only on a Claude subscription, and only after the first reply has reported them.
- Costs are the session's own estimates.

Made by H438 Design.
