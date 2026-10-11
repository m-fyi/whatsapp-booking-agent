import { describe, expect, it, vi } from "vitest";
import { createEngine } from "../src/engine.js";
import { createMemoryStore } from "../src/store/memory.js";
import type { Outgoing } from "../src/whatsapp/types.js";
import { business, fakeClaude, now, reply, say, tap, textBlock, toolUse, TUESDAY } from "./helpers.js";

const ids = (out: Outgoing[]) => out.flatMap((o) => (o.kind === "list" ? o.rows : o.kind === "buttons" ? o.buttons : []).map((x) => x.id));

function setup(replies: Parameters<typeof fakeClaude>[0]) {
  const store = createMemoryStore();
  const claude = fakeClaude(replies);
  const onHandoff = vi.fn();
  const onError = vi.fn();
  const engine = createEngine({
    business, store, now, onHandoff, onError,
    agent: { create: claude.create, model: "claude-opus-5-5", effort: "low" },
  });
  return { store, claude, engine, onHandoff, onError };
}

describe("agent", () => {
  it("turns a full sentence into a confirmation card, and still books nothing until the tap", async () => {
    const { engine, store, claude } = setup([
      reply([toolUse("continue_booking", { serviceId: "haircut", staffId: "mert", date: TUESDAY, time: "12:00" })], "tool_use"),
      reply([textBlock("Mert has 12:00 free on Tuesday.")], "end_turn"),
    ]);

    const out = await engine.handle(say("1", "Haircut with Mert on Tuesday at noon?"));
    expect(out[0]).toEqual({ kind: "text", body: "Mert has 12:00 free on Tuesday." });
    expect(ids(out)).toEqual(["confirm:yes", "confirm:change"]);
    expect(store.bookings).toHaveLength(0);

    // Claude was told what happened, through the tool result.
    const second = claude.calls[1]!.messages.at(-1)!;
    expect(JSON.stringify(second.content)).toContain("Nothing is booked until the customer taps");

    await engine.handle(tap("1", "confirm:yes"));
    expect(store.bookings).toMatchObject([{ staffId: "mert", date: TUESDAY, start: 720 }]);
  });

  it("shows real free times when Claude asks for one that is not free", async () => {
    const { engine } = setup([
      reply([toolUse("continue_booking", { serviceId: "haircut", staffId: "mert", date: TUESDAY, time: "09:00" })], "tool_use"),
      reply([textBlock("Mert starts at 12:00 that day.")], "end_turn"),
    ]);
    const out = await engine.handle(say("1", "Mert, Tuesday 9am"));
    expect(ids(out)[0]).toBe(`slot:${TUESDAY}|12:00`);
  });

  it("sends a cacheable prompt, the clock after the cache breakpoint, and refusal fallback on", async () => {
    const { engine, claude } = setup([reply([textBlock("Hi!")], "end_turn")]);
    await engine.handle(say("1", "hi"));
    const params = claude.calls[0]!;
    const system = params.system as { text: string; cache_control?: unknown }[];
    expect(system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(system[0]!.text).not.toContain("2026-10-12");
    expect(system[1]!.text).toContain("2026-10-12");
    expect(params).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { effort: "low" } });
  });

  it("hands off to a person and then stays quiet for that customer", async () => {
    const { engine, claude, onHandoff } = setup([
      reply([toolUse("hand_off_to_human", { reason: "Wants to talk about a refund" })], "tool_use"),
    ]);
    const out = await engine.handle(say("1", "I want a refund, let me talk to someone"));
    expect(out).toEqual([{ kind: "text", body: "I've passed this to the team. Someone will reply here soon." }]);
    expect(onHandoff).toHaveBeenCalledWith(expect.objectContaining({ phone: "1", paused: true }), "Wants to talk about a refund");

    expect(await engine.handle(say("1", "hello?"))).toEqual([]);
    expect(claude.calls).toHaveLength(1);
  });

  it("hands off when the model declines", async () => {
    const { engine, onHandoff } = setup([reply([], "refusal")]);
    await engine.handle(say("1", "..."));
    expect(onHandoff).toHaveBeenCalledOnce();
  });

  it("reports an API failure and tells the customer, instead of going silent", async () => {
    const { engine, onError } = setup([]);
    const out = await engine.handle(say("1", "hi"));
    expect(out).toEqual([{ kind: "text", body: "Sorry, something went wrong on my side. Please try again in a minute." }]);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("feeds earlier messages and taps back to Claude as history", async () => {
    const { engine, claude } = setup([reply([textBlock("Sure.")], "end_turn")]);
    await engine.handle(tap("1", "menu:book", "Book"));
    await engine.handle(say("1", "the second one"));
    const roles = claude.calls[0]!.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user"]);
    expect(claude.calls[0]!.messages[0]!.content).toBe("[tapped] Book");
  });
});
