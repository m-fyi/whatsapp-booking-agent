import { describe, expect, it } from "vitest";
import { createEngine } from "../src/engine.js";
import { createMemoryStore } from "../src/store/memory.js";
import type { Outgoing } from "../src/whatsapp/types.js";
import { business, now, say, tap, TUESDAY } from "./helpers.js";

const setup = () => {
  const store = createMemoryStore();
  return { store, engine: createEngine({ business, store, now }) };
};
const ids = (out: Outgoing[]) => out.flatMap((o) => (o.kind === "list" ? o.rows : o.kind === "buttons" ? o.buttons : []).map((x) => x.id));
const texts = (out: Outgoing[]) => out.filter((o) => o.kind === "text").map((o) => o.body);

async function reachCard(engine: ReturnType<typeof setup>["engine"], phone: string, slot: string) {
  await engine.handle(tap(phone, "menu:book"));
  await engine.handle(tap(phone, "svc:haircut"));
  await engine.handle(tap(phone, "staff:ayse"));
  await engine.handle(tap(phone, `day:${TUESDAY}`));
  return engine.handle(tap(phone, `slot:${TUESDAY}|${slot}`));
}

describe("booking by taps", () => {
  it("walks service → staff → day → time → card, and books only on the final tap", async () => {
    const { engine, store } = setup();
    expect(ids(await engine.handle(tap("1", "menu:book")))).toContain("svc:haircut");
    expect(ids(await engine.handle(tap("1", "svc:haircut")))).toEqual(["staff:any", "staff:ayse", "staff:mert"]);
    expect(ids(await engine.handle(tap("1", "staff:any")))[0]).toBe("day:2026-10-12");
    expect(ids(await engine.handle(tap("1", `day:${TUESDAY}`)))).toContain(`slot:${TUESDAY}|09:00`);
    expect(ids(await engine.handle(tap("1", `slot:${TUESDAY}|12:00`)))).toEqual(["confirm:yes", "confirm:change"]);
    expect(store.bookings).toHaveLength(0);

    const done = await engine.handle(tap("1", "confirm:yes"));
    expect(texts(done)[0]).toMatch(/^Booked/);
    expect(store.bookings).toMatchObject([{ serviceId: "haircut", staffId: "ayse", date: TUESDAY, start: 720, end: 765 }]);
  });

  it("skips the staff question when only one person offers the service", async () => {
    const { engine } = setup();
    await engine.handle(tap("1", "menu:book"));
    expect(ids(await engine.handle(tap("1", "svc:manicure")))[0]).toMatch(/^day:/);
  });

  it("tells the second customer the slot is gone and shows what is still free", async () => {
    const { engine, store } = setup();
    await reachCard(engine, "A", "09:00");
    await reachCard(engine, "B", "09:00");
    await engine.handle(tap("A", "confirm:yes"));

    const late = await engine.handle(tap("B", "confirm:yes"));
    expect(texts(late)[0]).toMatch(/just took that time/);
    expect(ids(late)).not.toContain(`slot:${TUESDAY}|09:00`);
    expect(ids(late)).toContain(`slot:${TUESDAY}|09:45`);
    expect(store.bookings).toHaveLength(1);
  });

  it("refuses two simultaneous bookings of the same slot at the store level", async () => {
    const store = createMemoryStore();
    const b = { serviceId: "haircut", staffId: "ayse", customerName: "X", date: TUESDAY, start: 540, end: 585 };
    const results = await Promise.all([store.createBooking({ ...b, phone: "A" }), store.createBooking({ ...b, phone: "B" })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "slot_taken" }]);
  });

  it("goes back to the times when the customer taps Change", async () => {
    const { engine } = setup();
    await reachCard(engine, "1", "12:00");
    expect(ids(await engine.handle(tap("1", "confirm:change")))).toContain(`slot:${TUESDAY}|12:00`);
  });
});

describe("cancelling", () => {
  it("asks first, then cancels only the customer's own booking", async () => {
    const { engine, store } = setup();
    await reachCard(engine, "1", "12:00");
    await engine.handle(tap("1", "confirm:yes"));
    const id = store.bookings[0]!.id;

    expect(ids(await engine.handle(tap("2", `cancelok:${id}`)))).toContain("menu:book"); // not theirs
    expect(store.bookings[0]!.status).toBe("confirmed");

    expect(ids(await engine.handle(tap("1", "menu:cancel")))).toEqual([`cancelok:${id}`, "keep"]);
    expect(texts(await engine.handle(tap("1", `cancelok:${id}`)))[0]).toMatch(/^Cancelled: Haircut/);
    expect(store.bookings[0]!.status).toBe("cancelled");
  });
});

describe("engine", () => {
  it("handles a re-delivered WhatsApp message only once", async () => {
    const { engine } = setup();
    const msg = tap("1", "menu:book");
    expect((await engine.handle(msg)).length).toBe(1);
    expect(await engine.handle(msg)).toEqual([]);
  });

  it("answers text with the main menu when no AI is configured", async () => {
    const { engine } = setup();
    expect(ids(await engine.handle(say("1", "hello")))).toEqual(["menu:book", "menu:mine", "menu:cancel"]);
  });

  it("answers an unknown or stale option with the main menu", async () => {
    const { engine } = setup();
    expect(ids(await engine.handle(tap("1", "slot:not-a-date|99:99")))).toEqual(["menu:book", "menu:mine", "menu:cancel"]);
  });
});
