import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Booking, Conversation, CreateBookingResult, NewBooking, Store } from "./types.js";

/**
 * Supabase (Postgres) store. Run `supabase/schema.sql` first.
 *
 * Double booking is stopped by the database itself: an exclusion constraint
 * refuses overlapping confirmed bookings for the same staff member, so two
 * servers racing for one slot cannot both win.
 *
 * Use the service role key on the server only. The tables have row level
 * security on and no policies, so the anon key cannot read them.
 */

type BookingRow = {
  id: string;
  service_id: string;
  staff_id: string;
  phone: string;
  customer_name: string;
  date: string;
  start_min: number;
  end_min: number;
  status: Booking["status"];
  created_at: string;
};

const toBooking = (r: BookingRow): Booking => ({
  id: r.id,
  serviceId: r.service_id,
  staffId: r.staff_id,
  phone: r.phone,
  customerName: r.customer_name,
  date: r.date,
  start: r.start_min,
  end: r.end_min,
  status: r.status,
  createdAt: r.created_at,
});

/** Postgres error codes we expect and handle; everything else is thrown. */
const UNIQUE_VIOLATION = "23505";
const EXCLUSION_VIOLATION = "23P01";

function fail(what: string, error: { message: string; code?: string }): never {
  throw new Error(`Supabase ${what} failed (${error.code ?? "no code"}): ${error.message}`);
}

export function createSupabaseStore(opts: { url: string; serviceRoleKey: string } | { client: SupabaseClient }): Store {
  const db = "client" in opts ? opts.client : createClient(opts.url, opts.serviceRoleKey, { auth: { persistSession: false } });

  return {
    async getConversation(phone) {
      const { data, error } = await db.from("wba_conversations").select("*").eq("phone", phone).maybeSingle();
      if (error) fail("getConversation", error);
      if (!data) return null;
      return {
        phone: data.phone,
        name: data.name,
        history: data.history ?? [],
        draft: data.draft ?? {},
        paused: data.paused,
        updatedAt: data.updated_at,
      } satisfies Conversation;
    },
    async saveConversation(c) {
      const { error } = await db.from("wba_conversations").upsert({
        phone: c.phone,
        name: c.name,
        history: c.history,
        draft: c.draft,
        paused: c.paused,
        updated_at: c.updatedAt,
      });
      if (error) fail("saveConversation", error);
    },
    async markProcessed(id) {
      const { error } = await db.from("wba_processed_messages").insert({ id });
      if (!error) return true;
      if (error.code === UNIQUE_VIOLATION) return false;
      fail("markProcessed", error);
    },
    async bookingsOn(date) {
      const { data, error } = await db.from("wba_bookings").select("*").eq("date", date).eq("status", "confirmed");
      if (error) fail("bookingsOn", error);
      return (data as BookingRow[]).map(toBooking);
    },
    async upcomingBookings(phone, fromDate) {
      const { data, error } = await db
        .from("wba_bookings")
        .select("*")
        .eq("phone", phone)
        .eq("status", "confirmed")
        .gte("date", fromDate)
        .order("date")
        .order("start_min");
      if (error) fail("upcomingBookings", error);
      return (data as BookingRow[]).map(toBooking);
    },
    async createBooking(b: NewBooking): Promise<CreateBookingResult> {
      const { data, error } = await db
        .from("wba_bookings")
        .insert({
          service_id: b.serviceId,
          staff_id: b.staffId,
          phone: b.phone,
          customer_name: b.customerName,
          date: b.date,
          start_min: b.start,
          end_min: b.end,
        })
        .select("*")
        .single();
      if (error?.code === EXCLUSION_VIOLATION) return { ok: false, reason: "slot_taken" };
      if (error) fail("createBooking", error);
      return { ok: true, booking: toBooking(data as BookingRow) };
    },
    async cancelBooking(id, phone) {
      const { data, error } = await db
        .from("wba_bookings")
        .update({ status: "cancelled" })
        .eq("id", id)
        .eq("phone", phone)
        .eq("status", "confirmed")
        .select("*")
        .maybeSingle();
      if (error) fail("cancelBooking", error);
      return data ? toBooking(data as BookingRow) : null;
    },
  };
}
