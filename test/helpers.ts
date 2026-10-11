import type Anthropic from "@anthropic-ai/sdk";
import { loadBusiness } from "../src/config.js";
import type { CreateMessage } from "../src/agent/agent.js";
import type { Inbound } from "../src/whatsapp/types.js";

export const business = loadBusiness("examples/salon.json");

/** Monday 12 October 2026, 10:00 in Istanbul (UTC+3). */
export const NOW = new Date("2026-10-12T07:00:00Z");
export const now = () => NOW;
export const MONDAY = "2026-10-12";
export const TUESDAY = "2026-10-13";
export const SUNDAY = "2026-10-18";

let n = 0;
export const tap = (from: string, id: string, title = id): Inbound => ({ messageId: `m${++n}`, from, name: "Test", type: "tap", id, title });
export const say = (from: string, textBody: string): Inbound => ({ messageId: `m${++n}`, from, name: "Test", type: "text", text: textBody });

type Block = Anthropic.Beta.BetaContentBlock;

export function reply(content: Block[], stop_reason: Anthropic.Beta.BetaStopReason): Anthropic.Beta.BetaMessage {
  return {
    id: `msg_${++n}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Anthropic.Beta.BetaMessage;
}

export const toolUse = (name: string, input: Record<string, unknown>) =>
  ({ type: "tool_use", id: `toolu_${++n}`, name, input }) as unknown as Block;
export const textBlock = (t: string) => ({ type: "text", text: t, citations: null }) as unknown as Block;

/** A scripted Claude: returns the given replies in order and records every request. */
export function fakeClaude(replies: Anthropic.Beta.BetaMessage[]) {
  const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const create: CreateMessage = async (params) => {
    calls.push(structuredClone(params));
    const next = replies.shift();
    if (!next) throw new Error("fakeClaude: no reply left");
    return next;
  };
  return { create, calls };
}
