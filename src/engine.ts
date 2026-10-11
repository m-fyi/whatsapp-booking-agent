import { runAgent, type AgentOptions } from "./agent/agent.js";
import type { Business } from "./config.js";
import { handleTap, type FlowContext } from "./flow.js";
import { strings } from "./i18n.js";
import { mainMenu, text } from "./menus.js";
import type { Conversation, Store } from "./store/types.js";
import type { Inbound, Outgoing } from "./whatsapp/types.js";

export type EngineOptions = {
  business: Business;
  store: Store;
  /** Leave out to run without AI: text messages then get the main menu. */
  agent?: AgentOptions;
  now?: () => Date;
  /** Called when the bot hands a conversation to a person. Notify your team here. */
  onHandoff?: (conversation: Conversation, reason: string) => void | Promise<void>;
  /** Called with every unexpected error. Defaults to console.error. */
  onError?: (error: unknown) => void;
  /** Messages of history kept per customer. */
  historyLimit?: number;
};

export type Engine = { handle(message: Inbound): Promise<Outgoing[]> };

/** One line per outgoing message, so Claude knows what the customer can see. */
function describe(out: Outgoing[]): string {
  return out
    .map((o) =>
      o.kind === "text"
        ? o.body
        : `[menu] ${o.body} (${(o.kind === "list" ? o.rows : o.buttons).map((x) => x.title).join(", ")})`,
    )
    .join("\n");
}

export function createEngine(opts: EngineOptions): Engine {
  const { business, store } = opts;
  const t = strings[business.language];
  const onError = opts.onError ?? ((e) => console.error("[whatsapp-booking-agent]", e));
  const ctx: FlowContext = { business, store, now: opts.now ?? (() => new Date()) };
  const agent = opts.agent ? { ...opts.agent, onError: opts.agent.onError ?? onError } : undefined;

  async function handle(msg: Inbound): Promise<Outgoing[]> {
    if (msg.messageId && !(await store.markProcessed(msg.messageId))) return [];

    const convo: Conversation = (await store.getConversation(msg.from)) ?? {
      phone: msg.from,
      name: null,
      history: [],
      draft: {},
      paused: false,
      updatedAt: new Date().toISOString(),
    };
    if (msg.name) convo.name = msg.name;

    const said = msg.type === "text" ? msg.text : msg.type === "tap" ? `[tapped] ${msg.title}` : `[sent ${msg.mediaType}]`;
    let out: Outgoing[] = [];
    let handoff: string | undefined;

    if (!convo.paused) {
      if (msg.type === "tap") {
        out = await handleTap(ctx, convo, msg.id);
      } else if (msg.type === "media") {
        out = [text(t.textOnly)];
      } else if (!agent) {
        out = [mainMenu(business)];
      } else {
        try {
          ({ out, handoff } = await runAgent(ctx, convo, msg.text, agent));
        } catch (error) {
          // Logged loudly and the customer is told. Never an empty reply.
          onError(error);
          out = [text(t.failed)];
        }
      }
    }

    if (handoff) {
      convo.paused = true;
      out = [text(t.handedOff)];
      await Promise.resolve(opts.onHandoff?.(convo, handoff)).catch(onError);
    }

    convo.history.push({ role: "user", text: said });
    if (out.length) convo.history.push({ role: "assistant", text: describe(out) });
    convo.history = convo.history.slice(-(opts.historyLimit ?? 30));
    convo.updatedAt = new Date().toISOString();
    await store.saveConversation(convo);
    return out;
  }

  // Messages from one customer are handled one at a time, in order, so two
  // quick taps cannot read and write the same conversation at once.
  const queues = new Map<string, Promise<unknown>>();
  return {
    handle(msg) {
      const previous = queues.get(msg.from) ?? Promise.resolve();
      const run = previous.catch(() => undefined).then(() => handle(msg));
      queues.set(msg.from, run);
      void run.finally(() => {
        if (queues.get(msg.from) === run) queues.delete(msg.from);
      }).catch(() => undefined);
      return run;
    },
  };
}
