# usage-pace

A Claude Code mod: one line above the prompt that tells you whether you're using your subscription limits too fast, and when your prompt cache goes cold.

```
Cache 42m ☒  Ctx 84k ▬▬▬▬▬  $2.60      5h 10% -4%  ▬▬▬▬|▬▬▬▬▬▬▬  4:30 PM      Week 82% +3%  ▬▬▬▬▬▬▬▬|¦▬  Wed 11:00 PM
```

**Hover text:** each item carries an explanation with live numbers (pace against steady use, reset time, what the colours mean). It shows in a small card above the bar while the pointer is on the item. Surfaces without a pointer do not show it.

- **Cache**: minutes left on the prompt cache (green), `cold` (blue) once it expired.
- **☒ (away note)**, on by default, click to toggle: when the session has been idle and the 1-hour cache has 5 minutes left, the mod asks Claude to write a short handoff note while the cache is still cheap to read. `✓` means it is done for this time away. Your next message re-arms it, except `end session`, `checkpoint` or `handoff`, which write their own handoff, so nothing fires after them. It uses the project's own handoff format when the project defines one (writing only the note, never committing or pushing), otherwise `handoffs/<topic>.md` or `HANDOFF.md`.
- **Ctx**: tokens in the conversation's context, with a short bar where full = 200k (too heavy: every reply re-reads all of it). Green below 110k, yellow from 110k, red from 150k: time to start a fresh session. Then the session's total cost so far, in USD, at API list prices.
- **5h / Week**: % used, then how far over (`+`) or under (`-`) steady use you are. The bar runs from the last reset to the next; the grey tick is where steady use would be right now.
- **Recovery tick (week only)**: the blue dashed tick is where steady use will be 8 hours from now. If your fill is at or left of it, stopping for the night gets you back on track by morning.
- **Colours** follow pace, not total use: green up to 2% over steady use, yellow up to the recovery tick, red past it. The 5-hour bar has no recovery tick and goes red at 15% over.
- Every session shares its latest limit reading, so open sessions update when you use Claude Code elsewhere.
- `/usage-bar` hides or shows the line.

## Install

### Easiest: ask Claude

On any computer with Claude Code (the desktop app's Code tab or a terminal), paste this into a session in any folder:

> Install the usage-pace mod from GitHub H438Design/usage-pace at user scope, following "Steps for Claude" in its README, then tell me to restart.

#### Steps for Claude

1. Run `claude plugin install usage-pace --marketplace H438Design/usage-pace`. It adds the marketplace to user settings and installs at user scope (the default), so the mod runs in every session, the desktop app's included. Answer yes if asked to add the marketplace.
2. If `claude` is not on the PATH (only the desktop app is installed), use the `claude` executable bundled with the app instead. On Windows it is the newest `claude.exe` under `%LOCALAPPDATA%\Claude-Data\*\claude-code\<version>\*\`.
3. Check with `claude plugin list`: `usage-pace@usage-pace`, scope user, enabled.
4. Tell the person to restart the app (or start a new terminal session). The line shows above the prompt; 5h and Week fill in after the first reply.

### By hand

In a terminal Claude Code session: `/plugin install usage-pace --marketplace H438Design/usage-pace`, or from a shell: `claude plugin install usage-pace --marketplace H438Design/usage-pace`. Choose the **user** scope so it runs in every session.

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `H438Design/usage-pace`, then Add plugin.

### Update and turn off

Update: `claude plugin update usage-pace`, then restart. The mod checks GitHub once a day and shows a notice when a newer version is out. Turn off / on: `claude plugin disable usage-pace` / `claude plugin enable usage-pace`.

## Notes

- Built against Claude Code 2.1.326. The mod API is early access and may change.
- Shows limits only on a Claude subscription, and only after the first reply has reported them.
- Costs are the session's own estimates.
- `tests/` holds render tests: `claude plugin test .`

Made by H438 Design.
