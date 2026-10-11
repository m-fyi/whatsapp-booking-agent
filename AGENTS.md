# AGENTS.md

Notes for AI coding agents working in this repo.

## Commands

- `npm test` runs the Vitest suite. No API key or network needed.
- `npm run typecheck` runs strict TypeScript.
- `npm run chat` starts the terminal chat. It works without `ANTHROPIC_API_KEY` (menus only).
- `npm start` starts the WhatsApp webhook server and needs the variables in `.env.example`.

Run `npm run typecheck && npm test` before you finish any change.

## Map

| File | Job |
|---|---|
| `src/engine.ts` | Entry point for one inbound message: dedupe, load conversation, route, save |
| `src/flow.ts` | `advance()` picks the next booking step; `handleTap()` handles menu taps; `book()` writes bookings |
| `src/agent/agent.ts` | Claude tool loop and tool definitions |
| `src/agent/prompt.ts` | System prompt: a stable cached part and a volatile clock part |
| `src/availability.ts` | Pure slot math, no I/O |
| `src/menus.ts` | WhatsApp list and button builders, and the option-id format |
| `src/store/*` | `Store` interface, memory store, Supabase store |
| `src/whatsapp/*` | Webhook parsing, signature check, Cloud API client |
| `src/i18n.ts` | Every fixed sentence, in English and Turkish |

## Rules that must hold

1. **No AI tool writes or cancels a booking.** `book()` in `flow.ts` is the only writer, and only a `confirm:yes` tap reaches it. Cancelling works the same way (`cancelok:` tap). Do not add a tool that books, even "for convenience".
2. **`book()` checks availability again before writing.** The confirmation card may be stale.
3. **The store refuses overlapping bookings itself** (exclusion constraint in Postgres, a synchronous check in memory). Availability checks alone are not enough under concurrency.
4. **Errors are never swallowed.** Report them through `onError`, and send the customer a reply. Never return an empty reply because a query failed.
5. **Tool calls run one at a time, in order.** Each one reads the draft the previous one left.
6. **Keep the system prompt prefix stable.** Anything that changes per request (the clock, the customer's name) goes in the second system block, after the cache breakpoint.
7. **Taps never reach Claude.** They are deterministic and free.

## Adding things

- **A language:** add a `Strings` object in `src/i18n.ts`, add it to the `language` enum in `src/config.ts`, add a locale in `src/time.ts`.
- **A store:** implement `Store` from `src/store/types.ts`. Make `createBooking` return `{ ok: false, reason: "slot_taken" }` on overlap, enforced atomically.
- **A tool:** add it in `buildTools()` and `runTool()` in `src/agent/agent.ts`. It may read data or return menus. It must not write bookings.
- **A test:** use `fakeClaude()` from `test/helpers.ts` to script Claude's replies.
