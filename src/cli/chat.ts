import { createInterface } from "node:readline";
import { engineFromEnv } from "../setup.js";
import type { Outgoing } from "../whatsapp/types.js";

/*
 * Talk to the bot in your terminal. No WhatsApp account needed.
 * Menus show up numbered; type a number to tap that option.
 */

const { engine, business, aiEnabled } = engineFromEnv({
  onHandoff: (_c, reason) => console.log(`\x1b[33m  [handed to the team: ${reason}]\x1b[0m`),
});

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
let options: { id: string; title: string }[] = [];
let messageNo = 0;
const phone = "905550000000";

function render(out: Outgoing[]) {
  options = [];
  for (const o of out) {
    console.log(`\n${bold(business.assistantName)}: ${o.body}`);
    if (o.kind === "text") continue;
    const items = o.kind === "list" ? o.rows : o.buttons;
    for (const item of items) {
      options.push({ id: item.id, title: item.title });
      const desc = "description" in item && item.description ? dim(`  ${item.description}`) : "";
      console.log(`   ${options.length}. ${item.title}${desc}`);
    }
  }
}

console.log(bold(`\n${business.name}`) + dim(` · ${aiEnabled ? "Claude on" : "no ANTHROPIC_API_KEY, menus only"} · /quit to exit\n`));
if (!aiEnabled) console.log(dim("Typed messages get the main menu. Set ANTHROPIC_API_KEY in .env to chat with Claude.\n"));

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.setPrompt("\nyou: ");
rl.prompt();
// Line by line instead of rl.question(), so piped input works too.
for await (const raw of rl) {
  const line = raw.trim();
  if (line === "/quit") break;
  if (!line) {
    rl.prompt();
    continue;
  }
  if (!process.stdin.isTTY) console.log(line);
  const pick = /^\d+$/.test(line) ? options[Number(line) - 1] : undefined;
  const out = await engine.handle(
    pick
      ? { messageId: `cli-${++messageNo}`, from: phone, name: "Demo Customer", type: "tap", id: pick.id, title: pick.title }
      : { messageId: `cli-${++messageNo}`, from: phone, name: "Demo Customer", type: "text", text: line },
  );
  if (pick) console.log(dim(`   (tapped "${pick.title}")`));
  render(out);
  rl.prompt();
}
rl.close();
