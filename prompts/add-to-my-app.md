# Add a WhatsApp booking assistant to my app

Paste everything below into Claude Code, Cursor or another coding agent, inside your own project.

---

I want to add a WhatsApp booking assistant to this project, based on the open-source repo https://github.com/m-fyi/whatsapp-booking-agent (MIT).

How that repo works:
- Customers message a WhatsApp number. Text goes to Claude, which answers with native WhatsApp list and button menus. Taps on those menus are handled by plain code and never reach the model.
- One function, `advance()`, decides the next booking step (service → staff → day → time → confirmation card) for both paths.
- **The AI has no tool that books or cancels.** Only the customer's tap on the confirmation card calls `book()`, which re-checks the slot and then writes. Keep this rule exactly.
- Storage is behind a small `Store` interface (`src/store/types.ts`). `createBooking` must refuse overlapping bookings atomically (a database constraint, not only a check in code).

Please do this:

1. Read the repo's `AGENTS.md` and `src/` first. Clone it into a temporary folder if you need to.
2. Look at my project and tell me, in a short plan, before you write code:
   - where the webhook route should live (my framework and router),
   - how my existing data maps to the `Business` config (services, staff, opening hours). Use my tables instead of a JSON file if I already have them,
   - which `Store` implementation fits my database. If I use Postgres, copy the exclusion constraint from `supabase/schema.sql`.
3. After I approve the plan, copy the engine (`engine.ts`, `flow.ts`, `availability.ts`, `menus.ts`, `i18n.ts`, `time.ts`, `agent/`, `whatsapp/`) into my project, adapt the imports, and write the `Store` for my database.
4. Add a webhook route that verifies `X-Hub-Signature-256` over the raw body, answers 200 at once, and then calls `engine.handle()` for each parsed message.
5. Keep these rules from `AGENTS.md`: no tool books; `book()` re-checks; the store blocks overlaps; errors go to `onError` and the customer still gets a reply; tool calls run in order.
6. Copy the tests from `test/` and make them pass against my `Store`, especially "a confirmation card alone never creates a booking" and the double-booking test.
7. List the environment variables I need to set, and the exact steps to register the webhook in Meta's dashboard.

Use the Anthropic SDK (`@anthropic-ai/sdk`) for Claude. The default model is `claude-opus-5-5` at `effort: "low"`; make the model configurable.
