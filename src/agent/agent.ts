import type Anthropic from "@anthropic-ai/sdk";
import type { Business } from "../config.js";
import { advance, cancelStep, upcoming, type FlowContext } from "../flow.js";
import { describeBooking, mainMenu, serviceMenu, text } from "../menus.js";
import type { Conversation } from "../store/types.js";
import { isDate, isTime } from "../time.js";
import type { Outgoing } from "../whatsapp/types.js";
import { stablePrompt, volatilePrompt } from "./prompt.js";

type Tool = Anthropic.Beta.BetaTool;
type MessageParam = Anthropic.Beta.BetaMessageParam;

/** `client.beta.messages.create`, or a fake one in tests. */
export type CreateMessage = (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;

export type AgentOptions = {
  create: CreateMessage;
  model: string;
  effort: "low" | "medium" | "high";
  /** Model calls per customer message before giving up and handing off. */
  maxSteps?: number;
  onError?: (error: unknown) => void;
};

export type AgentResult = { out: Outgoing[]; handoff?: string };

/** Retries a declined request on another model, server-side, in the same call. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/*
 * Every tool reads or sends a menu. None of them writes a booking: that only
 * happens in flow.ts when the customer taps "Book it". So a model mistake can
 * show the wrong menu, but it can never create or cancel an appointment.
 */
export function buildTools(b: Business): Tool[] {
  return [
    {
      name: "continue_booking",
      description:
        "Moves a booking forward. Pass everything the customer has said so far. The system sends the next step it still needs (staff, day or time menu) or the confirmation card. This does not book anything.",
      input_schema: {
        type: "object",
        properties: {
          serviceId: { type: "string", enum: b.services.map((s) => s.id) },
          staffId: { type: "string", enum: ["any", ...b.staff.map((m) => m.id)], description: 'A staff id, or "any".' },
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: "string", description: "HH:MM, 24-hour" },
        },
        required: ["serviceId"],
      },
    },
    {
      name: "show_services",
      description: "Sends the services as a menu. Use it when the customer wants to book but has not said which service.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "show_main_menu",
      description: "Sends the main menu buttons (book, my bookings, cancel). Use it after a greeting when the customer has not said what they want.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "list_my_bookings",
      description: "Returns the customer's upcoming bookings, for answering questions about them. Sends nothing.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "start_cancellation",
      description: "Sends the customer's upcoming bookings so they can tap the one to cancel. You cannot cancel by yourself.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "hand_off_to_human",
      description: "Passes the conversation to the team and stops the bot for this customer.",
      input_schema: {
        type: "object",
        properties: { reason: { type: "string", description: "One line for the team." } },
        required: ["reason"],
      },
    },
  ];
}

type ToolOutcome = { note: string; out?: Outgoing[]; handoff?: string };

async function runTool(ctx: FlowContext, convo: Conversation, name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
  const b = ctx.business;
  switch (name) {
    case "continue_booking": {
      const serviceId = String(input.serviceId ?? "");
      const date = typeof input.date === "string" ? input.date : undefined;
      const time = typeof input.time === "string" ? input.time : undefined;
      if (date && !isDate(date)) return { note: "Error: date must be YYYY-MM-DD." };
      if (time && !isTime(time)) return { note: "Error: time must be HH:MM, 24-hour." };
      const same = convo.draft.serviceId === serviceId;
      convo.draft = {
        serviceId,
        staffId: typeof input.staffId === "string" ? input.staffId : same ? convo.draft.staffId : undefined,
        date: date ?? convo.draft.date,
        time: time ?? (same && !date ? convo.draft.time : undefined),
      };
      const step = await advance(ctx, convo);
      return { note: step.note, out: step.out };
    }
    case "show_services":
      convo.draft = {};
      return { note: "Sent the services menu.", out: [serviceMenu(b)] };
    case "show_main_menu":
      return { note: "Sent the main menu.", out: [mainMenu(b)] };
    case "list_my_bookings": {
      const list = await upcoming(ctx, convo);
      return { note: list.length ? list.map((x) => describeBooking(b, x)).join("\n") : "No upcoming bookings." };
    }
    case "start_cancellation": {
      const step = await cancelStep(ctx, convo);
      return { note: step.note, out: step.out };
    }
    case "hand_off_to_human":
      return { note: "Handed off.", handoff: String(input.reason ?? "Customer asked for a person.") };
    default:
      return { note: `Error: unknown tool ${name}.` };
  }
}

/** Answers one text message. Runs Claude's tool loop until it writes a reply. */
export async function runAgent(ctx: FlowContext, convo: Conversation, userText: string, opts: AgentOptions): Promise<AgentResult> {
  const b = ctx.business;
  const tools = buildTools(b);
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    // Cache breakpoint: tools + the stable prompt are cached; the clock below is not.
    { type: "text", text: stablePrompt(b), cache_control: { type: "ephemeral" } },
    { type: "text", text: volatilePrompt(b, ctx.now(), convo.name) },
  ];

  const history = convo.history.slice(convo.history.findIndex((h) => h.role === "user"));
  const messages: MessageParam[] = [
    ...(convo.history.some((h) => h.role === "user") ? history : []).map((h): MessageParam => ({ role: h.role, content: h.text })),
    { role: "user", content: userText },
  ];

  const menus: Outgoing[] = [];
  for (let step = 0; step < (opts.maxSteps ?? 6); step++) {
    const res = await opts.create({
      model: opts.model,
      max_tokens: 16000,
      system,
      tools,
      messages,
      output_config: { effort: opts.effort },
      betas: [FALLBACK_BETA],
      fallbacks: "default",
    });

    if (res.stop_reason === "refusal") return { out: [], handoff: "The model declined to answer this message." };
    if (res.stop_reason !== "tool_use") {
      const reply = res.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();
      const out = [...(reply ? [text(reply)] : []), ...menus];
      return { out: out.length ? out : [mainMenu(b)] };
    }

    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    // One at a time, in order: each tool reads the draft the previous one left.
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      try {
        const outcome = await runTool(ctx, convo, block.name, block.input as Record<string, unknown>);
        if (outcome.handoff) return { out: [], handoff: outcome.handoff };
        if (outcome.out) menus.push(...outcome.out);
        results.push({ type: "tool_result", tool_use_id: block.id, content: outcome.note });
      } catch (error) {
        opts.onError?.(error);
        results.push({ type: "tool_result", tool_use_id: block.id, content: "The tool failed. Apologise briefly and offer the team.", is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { out: [], handoff: "The assistant could not finish this message." };
}
