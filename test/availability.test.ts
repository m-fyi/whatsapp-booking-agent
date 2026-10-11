import { describe, expect, it } from "vitest";
import { findSlots, openDates, spreadSlots } from "../src/availability.js";
import type { Booking } from "../src/store/types.js";
import { business, MONDAY, NOW, SUNDAY, TUESDAY } from "./helpers.js";

const booking = (b: Partial<Booking>): Booking => ({
  id: "b1", serviceId: "haircut", staffId: "ayse", phone: "900", customerName: "X",
  date: TUESDAY, start: 540, end: 585, status: "confirmed", createdAt: "", ...b,
});
const slots = (input: Partial<Parameters<typeof findSlots>[0]>) => {
  const r = findSlots({ business, serviceId: "haircut", date: TUESDAY, bookings: [], now: NOW, ...input });
  if (!r.ok) throw new Error(r.problem);
  return r.slots;
};

describe("findSlots", () => {
  it("starts today's slots after the minimum lead time", () => {
    // 10:00 now + 60 min lead. Mert is off on Mondays, so only Ayşe.
    const s = slots({ date: MONDAY });
    expect(s[0]).toEqual({ time: "11:00", staff: [{ id: "ayse", name: "Ayşe" }] });
    expect(s.at(-1)?.time).toBe("18:15"); // 45 minutes must fit before 19:00
  });

  it("intersects each person's own hours with the business hours", () => {
    const s = slots({});
    expect(s.find((x) => x.time === "09:00")?.staff.map((m) => m.id)).toEqual(["ayse"]);
    expect(s.find((x) => x.time === "12:00")?.staff.map((m) => m.id)).toEqual(["ayse", "mert"]);
  });

  it("removes times that overlap a booking of that person", () => {
    const s = slots({ bookings: [booking({ start: 540, end: 585 })] }); // Ayşe 09:00-09:45
    expect(s.find((x) => x.time === "09:00")).toBeUndefined();
    expect(s.find((x) => x.time === "09:45")?.staff.map((m) => m.id)).toEqual(["ayse"]);
  });

  it("does not let one customer book two people at the same time", () => {
    const own = booking({ staffId: "mert", phone: "555", start: 720, end: 765 }); // Mert 12:00, customer 555
    expect(slots({ bookings: [own], customerPhone: "555" }).find((x) => x.time === "12:00")).toBeUndefined();
    expect(slots({ bookings: [own], customerPhone: "777" }).find((x) => x.time === "12:00")?.staff.map((m) => m.id)).toEqual(["ayse"]);
  });

  it("filters by staff", () => {
    expect(slots({ date: MONDAY, staffId: "mert" })).toEqual([]);
    expect(slots({ staffId: "mert" })[0]?.time).toBe("12:00");
  });

  it("explains why a date does not work", () => {
    const problem = (date: string) => {
      const r = findSlots({ business, serviceId: "haircut", date, bookings: [], now: NOW });
      return r.ok ? null : r.problem;
    };
    expect(problem(SUNDAY)).toBe("closed");
    expect(problem("2026-10-11")).toBe("past_date");
    expect(problem("2026-10-27")).toBe("too_far"); // 15 days ahead, limit 14
    expect(findSlots({ business, serviceId: "massage", date: TUESDAY, bookings: [], now: NOW })).toEqual({ ok: false, problem: "unknown_service" });
  });
});

describe("openDates", () => {
  it("lists open days in the booking window and skips Sundays", () => {
    const dates = openDates(business, NOW);
    expect(dates[0]).toBe(MONDAY);
    expect(dates).not.toContain(SUNDAY);
    expect(dates.at(-1)).toBe("2026-10-26");
  });
});

describe("spreadSlots", () => {
  it("keeps ten slots spread across the day, first and last included", () => {
    const all = Array.from({ length: 30 }, (_, i) => i);
    const picked = spreadSlots(all);
    expect(picked).toHaveLength(10);
    expect(picked[0]).toBe(0);
    expect(picked.at(-1)).toBe(29);
  });
});
