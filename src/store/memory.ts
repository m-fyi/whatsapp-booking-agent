import { randomUUID } from "node:crypto";
import type { Booking, Conversation, CreateBookingResult, NewBooking, Store } from "./types.js";

/**
 * Keeps everything in process memory. Good for trying the bot and for tests;
 * data is gone when the process stops.
 *
 * `createBooking` checks and inserts without an `await` in between, so two
 * requests in the same process cannot both win the same slot.
 */
export function createMemoryStore(): Store & { bookings: Booking[] } {
  const conversations = new Map<string, Conversation>();
  const processed = new Set<string>();
  const bookings: Booking[] = [];
  const clone = <T>(v: T): T => structuredClone(v);

  return {
    bookings,
    async getConversation(phone) {
      const c = conversations.get(phone);
      return c ? clone(c) : null;
    },
    async saveConversation(c) {
      conversations.set(c.phone, clone(c));
    },
    async markProcessed(id) {
      if (processed.has(id)) return false;
      processed.add(id);
      return true;
    },
    async bookingsOn(date) {
      return bookings.filter((b) => b.date === date && b.status === "confirmed").map(clone);
    },
    async upcomingBookings(phone, fromDate) {
      return bookings
        .filter((b) => b.phone === phone && b.status === "confirmed" && b.date >= fromDate)
        .sort((a, z) => a.date.localeCompare(z.date) || a.start - z.start)
        .map(clone);
    },
    async createBooking(input: NewBooking): Promise<CreateBookingResult> {
      const clash = bookings.some(
        (b) =>
          b.status === "confirmed" &&
          b.staffId === input.staffId &&
          b.date === input.date &&
          b.start < input.end &&
          input.start < b.end,
      );
      if (clash) return { ok: false, reason: "slot_taken" };
      const booking: Booking = { ...input, id: randomUUID(), status: "confirmed", createdAt: new Date().toISOString() };
      bookings.push(booking);
      return { ok: true, booking: clone(booking) };
    },
    async cancelBooking(id, phone) {
      const b = bookings.find((x) => x.id === id && x.phone === phone && x.status === "confirmed");
      if (!b) return null;
      b.status = "cancelled";
      return clone(b);
    },
  };
}
