import type { Business, StaffMember } from "./config.js";
import type { Booking } from "./store/types.js";
import { addDays, dayKey, localNow, toHHMM, toMinutes } from "./time.js";

export type Slot = { time: string; staff: { id: string; name: string }[] };

export type SlotProblem = "unknown_service" | "past_date" | "too_far" | "closed" | "no_staff";

export type SlotsResult = { ok: true; slots: Slot[] } | { ok: false; problem: SlotProblem };

type Interval = [number, number];

function subtract(window: Interval, busy: Interval[]): Interval[] {
  let free: Interval[] = [window];
  for (const [bs, be] of busy) {
    free = free.flatMap(([fs, fe]): Interval[] => {
      if (be <= fs || bs >= fe) return [[fs, fe]];
      const parts: Interval[] = [];
      if (bs > fs) parts.push([fs, bs]);
      if (be < fe) parts.push([be, fe]);
      return parts;
    });
  }
  return free;
}

export function staffFor(business: Business, serviceId: string): StaffMember[] {
  return business.staff.filter((m) => m.services.includes(serviceId));
}

/**
 * Free start times for one service on one date.
 *
 * A start time is free for a staff member when the whole service fits inside
 * their hours (intersected with the business hours) without touching one of
 * their bookings. The customer's own bookings block every staff member, since
 * one person cannot sit in two chairs.
 */
export function findSlots(input: {
  business: Business;
  serviceId: string;
  date: string;
  /** A staff id, or undefined / "any" for anyone. */
  staffId?: string;
  /** Confirmed bookings on `date`. */
  bookings: Booking[];
  customerPhone?: string;
  now: Date;
}): SlotsResult {
  const { business: b, date } = input;
  const service = b.services.find((s) => s.id === input.serviceId);
  if (!service) return { ok: false, problem: "unknown_service" };

  const today = localNow(input.now, b.timezone);
  if (date < today.date) return { ok: false, problem: "past_date" };
  if (date > addDays(today.date, b.maxLeadDays)) return { ok: false, problem: "too_far" };

  const key = dayKey(date);
  const open = b.hours[key];
  if (!open) return { ok: false, problem: "closed" };

  let staff = staffFor(b, service.id);
  if (input.staffId && input.staffId !== "any") staff = staff.filter((m) => m.id === input.staffId);
  if (staff.length === 0) return { ok: false, problem: "no_staff" };

  const customerBusy: Interval[] = input.customerPhone
    ? input.bookings.filter((x) => x.phone === input.customerPhone).map((x) => [x.start, x.end])
    : [];
  const earliest = date === today.date ? today.minutes + b.minLeadMinutes : 0;

  const byTime = new Map<number, Slot["staff"]>();
  for (const member of staff) {
    const own = (member.hours ?? b.hours)[key];
    if (!own) continue;
    const window: Interval = [
      Math.max(toMinutes(own[0]), toMinutes(open[0])),
      Math.min(toMinutes(own[1]), toMinutes(open[1])),
    ];
    if (window[0] >= window[1]) continue;

    const busy: Interval[] = [
      ...input.bookings.filter((x) => x.staffId === member.id).map((x): Interval => [x.start, x.end]),
      ...customerBusy,
    ];
    for (const [fs, fe] of subtract(window, busy)) {
      const step = b.slotStepMinutes;
      for (let t = Math.ceil(fs / step) * step; t + service.minutes <= fe; t += step) {
        if (t < earliest) continue;
        const list = byTime.get(t) ?? [];
        list.push({ id: member.id, name: member.name });
        byTime.set(t, list);
      }
    }
  }

  const slots = [...byTime.entries()].sort(([a], [z]) => a - z).map(([t, s]) => ({ time: toHHMM(t), staff: s }));
  return { ok: true, slots };
}

/** Dates inside the booking window when the business is open, starting today. */
export function openDates(business: Business, now: Date): string[] {
  const today = localNow(now, business.timezone).date;
  const out: string[] = [];
  for (let i = 0; i <= business.maxLeadDays; i++) {
    const date = addDays(today, i);
    if (business.hours[dayKey(date)]) out.push(date);
  }
  return out;
}

/** At most `max` slots, spread across the day instead of the first `max`. */
export function spreadSlots<T>(slots: T[], max = 10): T[] {
  if (slots.length <= max) return slots;
  const picked: T[] = [];
  for (let i = 0; i < max; i++) picked.push(slots[Math.round((i * (slots.length - 1)) / (max - 1))]!);
  return picked;
}
