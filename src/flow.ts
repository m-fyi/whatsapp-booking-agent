import { findSlots, openDates, staffFor } from "./availability.js";
import type { Business } from "./config.js";
import { strings } from "./i18n.js";
import {
  cancelAsk, cancelMenu, confirmCard, dayMenu, describeBooking, mainMenu, serviceMenu, staffMenu, text, timeMenu,
} from "./menus.js";
import type { Conversation, Store } from "./store/types.js";
import { formatDay, isDate, isTime, localNow, toMinutes } from "./time.js";
import type { Outgoing } from "./whatsapp/types.js";

export type FlowContext = { business: Business; store: Store; now: () => Date };

/** What to send, plus a one-line note that tells Claude what happened. */
export type Step = { out: Outgoing[]; note: string };

const today = (ctx: FlowContext) => localNow(ctx.now(), ctx.business.timezone).date;

/**
 * Looks at what the customer has picked so far and sends the next missing
 * step: service → staff → day → time → confirmation card.
 *
 * Taps and Claude's `continue_booking` tool both end up here, so the two
 * paths can never disagree about what comes next. It never saves a booking.
 */
export async function advance(ctx: FlowContext, convo: Conversation): Promise<Step> {
  const b = ctx.business;
  const t = strings[b.language];
  const d = convo.draft;

  if (!d.serviceId) return { out: [serviceMenu(b)], note: "Sent the services menu." };
  const service = b.services.find((s) => s.id === d.serviceId);
  if (!service) {
    convo.draft = {};
    return { out: [serviceMenu(b, t.problem("unknown_service", b.maxLeadDays))], note: "Unknown service id. Sent the services menu." };
  }

  const capable = staffFor(b, service.id);
  if (capable.length === 0) {
    convo.draft = {};
    return { out: [text(t.noStaff), mainMenu(b)], note: "Nobody offers this service." };
  }
  if (d.staffId && d.staffId !== "any" && !capable.some((m) => m.id === d.staffId)) d.staffId = undefined;
  if (!d.staffId) {
    if (capable.length === 1) d.staffId = capable[0]!.id;
    else return { out: [staffMenu(b, service)], note: "Sent the staff menu, asking who should do it." };
  }

  if (!d.date) {
    const dates = await datesWithFreeTimes(ctx, convo);
    if (dates.length === 0) {
      convo.draft = {};
      return { out: [text(t.noDays), mainMenu(b)], note: "No free times in the booking window." };
    }
    return { out: [dayMenu(b, dates)], note: "Sent the days menu (only days with free times)." };
  }

  const result = findSlots({
    business: b,
    serviceId: service.id,
    date: d.date,
    staffId: d.staffId,
    bookings: await ctx.store.bookingsOn(d.date),
    customerPhone: convo.phone,
    now: ctx.now(),
  });
  if (!result.ok || result.slots.length === 0) {
    const why = result.ok ? t.noTimes(formatDay(d.date, b.language)) : t.problem(result.problem, b.maxLeadDays);
    d.date = undefined;
    d.time = undefined;
    const next = await advance(ctx, convo);
    return { out: [text(why), ...next.out], note: `That date does not work (${why}) ${next.note}` };
  }

  if (!d.time) return { out: [timeMenu(b, d.date, result.slots)], note: "Sent the free times menu." };
  const slot = result.slots.find((s) => s.time === d.time);
  if (!slot) {
    d.time = undefined;
    return { out: [text(t.slotTaken), timeMenu(b, d.date, result.slots)], note: "That time is not free. Sent the free times instead." };
  }

  const staff = d.staffId === "any" ? slot.staff[0]! : slot.staff.find((m) => m.id === d.staffId)!;
  return {
    out: [confirmCard(b, { service, date: d.date, time: d.time, staffName: staff.name })],
    note: "Sent the confirmation card. Nothing is booked until the customer taps the button.",
  };
}

async function datesWithFreeTimes(ctx: FlowContext, convo: Conversation): Promise<string[]> {
  const found: string[] = [];
  for (const date of openDates(ctx.business, ctx.now())) {
    const r = findSlots({
      business: ctx.business,
      serviceId: convo.draft.serviceId!,
      date,
      staffId: convo.draft.staffId,
      bookings: await ctx.store.bookingsOn(date),
      customerPhone: convo.phone,
      now: ctx.now(),
    });
    if (r.ok && r.slots.length) found.push(date);
    if (found.length === 10) break;
  }
  return found;
}

/** The only place a booking is written. Reached only from a "confirm:yes" tap. */
async function book(ctx: FlowContext, convo: Conversation): Promise<Outgoing[]> {
  const b = ctx.business;
  const t = strings[b.language];
  const d = convo.draft;
  const service = b.services.find((s) => s.id === d.serviceId);
  if (!service || !d.staffId || !d.date || !d.time) {
    convo.draft = {};
    return [mainMenu(b, t.expired)];
  }

  // The card may be minutes old. Check the time again before writing.
  const result = findSlots({
    business: b,
    serviceId: service.id,
    date: d.date,
    staffId: d.staffId,
    bookings: await ctx.store.bookingsOn(d.date),
    customerPhone: convo.phone,
    now: ctx.now(),
  });
  const slot = result.ok ? result.slots.find((s) => s.time === d.time) : undefined;
  const staff = slot && (d.staffId === "any" ? slot.staff[0] : slot.staff.find((m) => m.id === d.staffId));
  if (!staff) {
    d.time = undefined;
    return [text(t.slotTaken), ...(await advance(ctx, convo)).out];
  }

  const start = toMinutes(d.time);
  const created = await ctx.store.createBooking({
    serviceId: service.id,
    staffId: staff.id,
    phone: convo.phone,
    customerName: convo.name ?? convo.phone,
    date: d.date,
    start,
    end: start + service.minutes,
  });
  if (!created.ok) {
    // Lost a race with another customer between our check and the insert.
    d.time = undefined;
    return [text(t.slotTaken), ...(await advance(ctx, convo)).out];
  }

  convo.draft = {};
  return [text(t.booked({ service: service.name, day: formatDay(d.date, b.language), time: d.time, staff: staff.name }))];
}

export async function upcoming(ctx: FlowContext, convo: Conversation) {
  return ctx.store.upcomingBookings(convo.phone, today(ctx));
}

export async function myBookingsMessage(ctx: FlowContext, convo: Conversation): Promise<Outgoing> {
  const t = strings[ctx.business.language];
  const list = await upcoming(ctx, convo);
  return text(list.length ? t.mineList(list.map((x) => `• ${describeBooking(ctx.business, x)}`)) : t.mineEmpty);
}

export async function cancelStep(ctx: FlowContext, convo: Conversation): Promise<Step> {
  const t = strings[ctx.business.language];
  const list = await upcoming(ctx, convo);
  if (list.length === 0) return { out: [text(t.mineEmpty)], note: "The customer has no upcoming bookings." };
  if (list.length === 1) return { out: [cancelAsk(ctx.business, list[0]!)], note: "Asked the customer to confirm the cancellation." };
  return { out: [cancelMenu(ctx.business, list)], note: "Sent the list of bookings to cancel." };
}

/** Handles a tap on any menu option. Taps never reach Claude. */
export async function handleTap(ctx: FlowContext, convo: Conversation, id: string): Promise<Outgoing[]> {
  const b = ctx.business;
  const t = strings[b.language];
  const d = convo.draft;
  const sep = id.indexOf(":");
  const head = sep === -1 ? id : id.slice(0, sep);
  const arg = sep === -1 ? "" : id.slice(sep + 1);

  switch (head) {
    case "menu":
      if (arg === "book") {
        convo.draft = {};
        return (await advance(ctx, convo)).out;
      }
      if (arg === "mine") return [await myBookingsMessage(ctx, convo)];
      if (arg === "cancel") return (await cancelStep(ctx, convo)).out;
      break;
    case "svc":
      convo.draft = { serviceId: arg, date: d.date };
      return (await advance(ctx, convo)).out;
    case "staff":
      d.staffId = arg;
      d.time = undefined;
      return (await advance(ctx, convo)).out;
    case "day":
      if (!isDate(arg)) break;
      d.date = arg;
      d.time = undefined;
      return (await advance(ctx, convo)).out;
    case "slot": {
      const [date = "", time = ""] = arg.split("|");
      if (!isDate(date) || !isTime(time)) break;
      d.date = date;
      d.time = time;
      return (await advance(ctx, convo)).out;
    }
    case "confirm":
      if (arg === "yes") return book(ctx, convo);
      d.time = undefined;
      return (await advance(ctx, convo)).out;
    case "cancel": {
      const booking = (await upcoming(ctx, convo)).find((x) => x.id === arg);
      return booking ? [cancelAsk(b, booking)] : [text(t.notFound), mainMenu(b)];
    }
    case "cancelok": {
      const cancelled = await ctx.store.cancelBooking(arg, convo.phone);
      return cancelled ? [text(t.cancelled(describeBooking(b, cancelled)))] : [text(t.notFound), mainMenu(b)];
    }
    case "keep":
      return [mainMenu(b, t.keptIt)];
  }
  // An old or unknown option: show the main menu rather than guessing.
  return [mainMenu(b)];
}
