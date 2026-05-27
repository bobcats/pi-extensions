---
name: notify
description: Send a desktop notification from the terminal. Use when the user asks to be notified on completion or after long-running builds, tests, refactors, or plan execution.
metadata:
  bucket: tools
---

# Notify

Send a short completion notification when requested or after long work where the user may have stepped away.

## Workflow

1. **Choose concise text**
   - Title: project/task name.
   - Body: pass/fail/blocked status and one next-action clue.

2. **Emit OSC 777 notification**
   ```bash
   printf '\033]777;notify;%s;%s\a' "Title" "Body"
   ```

3. **Do not replace normal reporting**
   - Still respond in the chat with verification and status.

## Use when

- user explicitly asks “notify me”
- long build/test/research completes
- multi-step plan finishes or blocks

## Stop and ask

Do not send repeated notifications for loops unless the user requested ongoing alerts.

## Output

Report that notification was sent and include the same status in the chat.
