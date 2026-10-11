import { spreadSlots, staffFor, type Slot } from "./availability.js";
import type { Business, Service } from "./config.js";
import { strings } from "./i18n.js";
import type { Booking } from "./store/types.js";
import { formatDay, formatDayShort, formatPrice, toHHMM } from "./time.js";
import type { Outgoing } from "./whatsapp/types.js";

/*
 * Option ids carry the state of a tap: "svc:haircut", "day:2026-10-12",
 * "slot:2026-10-12|14:30", "confirm:yes", "cancel:<booking id>".
 * flow.ts reads them back. No AI is involved once a menu is on screen.
 */

export function price(b: Business, service: Service): string | undefined {
  return service.price != null && b.currency ? formatPrice(service.price, b.currency, b.language) : undefined;
}

export function mainMenu(b: Business, body?: string): Outgoing {
  const t = strings[b.language];
  return {
    kind: "buttons",
    body: body ?? t.mainBody,
    buttons: [
      { id: "menu:book", title: t.mainBook },
      { id: "menu:mine", title: t.mainMine },
      { id: "menu:cancel", title: t.mainCancel },
    ],
  };
}

export function serviceMenu(b: Business, body?: string): Outgoing {
  const t = strings[b.language];
  return {
    kind: "list",
    body: body ?? t.servicesBody,
    button: t.servicesButton,
    rows: b.services.slice(0, 10).map((s) => ({
      id: `svc:${s.id}`,
      title: s.name,
      description: [t.minutes(s.minutes), price(b, s)].filter(Boolean).join(" · "),
    })),
  };
}

export function staffMenu(b: Business, service: Service): Outgoing {
  const t = strings[b.language];
  return {
    kind: "list",
    body: t.staffBody(service.name),
    button: t.staffButton,
    rows: [
      { id: "staff:any", title: t.staffAny },
      ...staffFor(b, service.id).slice(0, 9).map((m) => ({ id: `staff:${m.id}`, title: m.name })),
    ],
  };
}

export function dayMenu(b: Business, dates: string[]): Outgoing {
  const t = strings[b.language];
  return {
    kind: "list",
    body: t.daysBody,
    button: t.daysButton,
    rows: dates.slice(0, 10).map((d) => ({ id: `day:${d}`, title: formatDayShort(d, b.language) })),
  };
}

export function timeMenu(b: Business, date: string, slots: Slot[]): Outgoing {
  const t = strings[b.language];
  return {
    kind: "list",
    body: t.timesBody(formatDay(date, b.language)),
    button: t.timesButton,
    rows: spreadSlots(slots).map((s) => ({
      id: `slot:${date}|${s.time}`,
      title: s.time,
      description: s.staff.map((m) => m.name).join(", "),
    })),
  };
}

export function confirmCard(b: Business, d: { service: Service; date: string; time: string; staffName: string }): Outgoing {
  const t = strings[b.language];
  return {
    kind: "buttons",
    body: t.confirmBody({
      service: d.service.name,
      day: formatDay(d.date, b.language),
      time: d.time,
      staff: d.staffName,
      price: price(b, d.service),
    }),
    buttons: [
      { id: "confirm:yes", title: t.confirmYes },
      { id: "confirm:change", title: t.confirmNo },
    ],
  };
}

export function describeBooking(b: Business, booking: Booking): string {
  const service = b.services.find((s) => s.id === booking.serviceId)?.name ?? booking.serviceId;
  return `${service}, ${formatDay(booking.date, b.language)} ${toHHMM(booking.start)}`;
}

export function cancelMenu(b: Business, bookings: Booking[]): Outgoing {
  const t = strings[b.language];
  return {
    kind: "list",
    body: t.cancelBody,
    button: t.cancelButton,
    rows: bookings.slice(0, 10).map((x) => ({
      id: `cancel:${x.id}`,
      title: `${formatDayShort(x.date, b.language)} ${toHHMM(x.start)}`,
      description: b.services.find((s) => s.id === x.serviceId)?.name,
    })),
  };
}

export function cancelAsk(b: Business, booking: Booking): Outgoing {
  const t = strings[b.language];
  return {
    kind: "buttons",
    body: t.cancelAsk(describeBooking(b, booking)),
    buttons: [
      { id: `cancelok:${booking.id}`, title: t.cancelYes },
      { id: "keep", title: t.cancelNo },
    ],
  };
}

export const text = (body: string): Outgoing => ({ kind: "text", body });
