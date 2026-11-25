---
name: handoff
description: Write a short handoff note so the work can resume in a fresh session. Used by the usage-pace mod's away note when the person is away and the prompt cache is about to expire; the person can also ask for it by name.
---

# Handoff

The person is usually away when this runs. Ask nothing, start nothing, and keep it short: the point is a cheap save while the cache is still warm.

## 1. Does the project have its own way?

Check what is already in context (CLAUDE.md, the project's skills, an existing handoffs folder). If the project defines its own handoff note (for example an `end-session` or `checkpoint` skill that writes one), write **only that note**, in that project's place and format.

Do **not** run the rest of such a procedure: no time logging, reports, commits, pushes, publishing, messages, or starting new sessions. Those need the person.

## 2. Otherwise, write a simple note

Write to `handoffs/<short-topic>.md` if a `handoffs/` folder exists in the working directory, else to `HANDOFF.md` at its root. Overwrite an earlier note for the same topic.

```markdown
# <topic>

Updated: <YYYY-MM-DD HH:MM> · Away note (person away)

## Goal
<one or two lines>

## Where it stands
- <what is done, with file paths>
- <what is changed but not committed or not checked>

## Next step
<one concrete step to start the next session with>

## Watch out
- <anything non-obvious the next session would otherwise rediscover; omit if none>
```

Base it on this conversation only; read no new files to write it.

## 3. Finish

Reply in one line: where the note is and that nothing was committed.
