export type Booking = {
  id: string;
  serviceId: string;
  staffId: string;
  phone: string;
  customerName: string;
  /** YYYY-MM-DD in the business time zone. */
  date: string;
  /** Minutes since midnight, [start, end). */
  start: number;
  end: number;
  status: "confirmed" | "cancelled";
  createdAt: string;
};

export type NewBooking = Omit<Booking, "id" | "status" | "createdAt">;

export type CreateBookingResult = { ok: true; booking: Booking } | { ok: false; reason: "slot_taken" };

export type HistoryEntry = { role: "user" | "assistant"; text: string };

/**
 * What the customer has picked so far. `staffId: "any"` means they chose
 * "anyone"; `undefined` means they have not been asked yet.
 */
export type Draft = { serviceId?: string; staffId?: string; date?: string; time?: string };

export type Conversation = {
  phone: string;
  name: string | null;
  history: HistoryEntry[];
  draft: Draft;
  /** A human took over. The bot stores messages but does not answer. */
  paused: boolean;
  updatedAt: string;
};

export interface Store {
  getConversation(phone: string): Promise<Conversation | null>;
  saveConversation(conversation: Conversation): Promise<void>;
  /** Records a WhatsApp message id. Resolves `false` when it was already recorded. */
  markProcessed(messageId: string): Promise<boolean>;
  /** Confirmed bookings on one date. */
  bookingsOn(date: string): Promise<Booking[]>;
  /** A customer's confirmed bookings from `fromDate` on, soonest first. */
  upcomingBookings(phone: string, fromDate: string): Promise<Booking[]>;
  /**
   * Must refuse a booking that overlaps another confirmed booking of the same
   * staff member, even when two requests arrive at the same moment.
   */
  createBooking(booking: NewBooking): Promise<CreateBookingResult>;
  /** Cancels the booking only if it belongs to `phone`. */
  cancelBooking(id: string, phone: string): Promise<Booking | null>;
}
