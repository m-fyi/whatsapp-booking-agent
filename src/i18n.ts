import type { SlotProblem } from "./availability.js";

/** Every fixed sentence the bot sends. Claude writes its own replies; these are the menus and receipts. */
export type Strings = {
  mainBody: string;
  mainBook: string;
  mainMine: string;
  mainCancel: string;
  servicesBody: string;
  servicesButton: string;
  staffBody: (service: string) => string;
  staffAny: string;
  staffButton: string;
  daysBody: string;
  daysButton: string;
  timesBody: (day: string) => string;
  timesButton: string;
  confirmBody: (d: { service: string; day: string; time: string; staff: string; price?: string }) => string;
  confirmYes: string;
  confirmNo: string;
  booked: (d: { service: string; day: string; time: string; staff: string }) => string;
  slotTaken: string;
  noTimes: (day: string) => string;
  noDays: string;
  noStaff: string;
  expired: string;
  mineEmpty: string;
  mineList: (lines: string[]) => string;
  cancelBody: string;
  cancelButton: string;
  cancelAsk: (what: string) => string;
  cancelYes: string;
  cancelNo: string;
  cancelled: (what: string) => string;
  notFound: string;
  keptIt: string;
  textOnly: string;
  handedOff: string;
  failed: string;
  minutes: (n: number) => string;
  problem: (p: SlotProblem, maxLeadDays: number) => string;
};

const en: Strings = {
  mainBody: "What would you like to do?",
  mainBook: "Book",
  mainMine: "My bookings",
  mainCancel: "Cancel",
  servicesBody: "Which service would you like?",
  servicesButton: "Services",
  staffBody: (s) => `Who would you like for ${s}?`,
  staffAny: "Anyone",
  staffButton: "Staff",
  daysBody: "Which day works for you?",
  daysButton: "Days",
  timesBody: (d) => `Free times on ${d}:`,
  timesButton: "Times",
  confirmBody: (d) =>
    [`*${d.service}*`, `${d.day}, ${d.time}`, `with ${d.staff}`, d.price ? d.price : null, "", "Shall I book it?"]
      .filter((l) => l !== null)
      .join("\n"),
  confirmYes: "Book it",
  confirmNo: "Change",
  booked: (d) => `Booked ✅\n*${d.service}*\n${d.day}, ${d.time}\nwith ${d.staff}`,
  slotTaken: "Someone just took that time. Here are the times still free:",
  noTimes: (d) => `There are no free times left on ${d}.`,
  noDays: "There are no free times in the coming days.",
  noStaff: "Nobody offers this service at the moment.",
  expired: "That request has expired. Let's start again.",
  mineEmpty: "You have no upcoming bookings.",
  mineList: (lines) => `Your upcoming bookings:\n${lines.join("\n")}`,
  cancelBody: "Which booking should I cancel?",
  cancelButton: "Bookings",
  cancelAsk: (w) => `Cancel ${w}?`,
  cancelYes: "Yes, cancel",
  cancelNo: "Keep it",
  cancelled: (w) => `Cancelled: ${w}.`,
  notFound: "I couldn't find that booking.",
  keptIt: "Okay, nothing changed.",
  textOnly: "I can only read text messages for now. Could you type it?",
  handedOff: "I've passed this to the team. Someone will reply here soon.",
  failed: "Sorry, something went wrong on my side. Please try again in a minute.",
  minutes: (n) => `${n} min`,
  problem: (p, max) =>
    ({
      unknown_service: "I don't know that service.",
      past_date: "That date is in the past.",
      too_far: `I can only book up to ${max} days ahead.`,
      closed: "We're closed that day.",
      no_staff: "Nobody offers this service at the moment.",
    })[p],
};

const tr: Strings = {
  mainBody: "Ne yapmak istersiniz?",
  mainBook: "Randevu al",
  mainMine: "Randevularım",
  mainCancel: "İptal et",
  servicesBody: "Hangi hizmeti istersiniz?",
  servicesButton: "Hizmetler",
  staffBody: (s) => `${s} için kimi tercih edersiniz?`,
  staffAny: "Farketmez",
  staffButton: "Ekip",
  daysBody: "Hangi gün size uygun?",
  daysButton: "Günler",
  timesBody: (d) => `${d} için boş saatler:`,
  timesButton: "Saatler",
  confirmBody: (d) =>
    [`*${d.service}*`, `${d.day}, ${d.time}`, d.staff, d.price ? d.price : null, "", "Onaylıyor musunuz?"]
      .filter((l) => l !== null)
      .join("\n"),
  confirmYes: "Onayla",
  confirmNo: "Değiştir",
  booked: (d) => `Randevunuz alındı ✅\n*${d.service}*\n${d.day}, ${d.time}\n${d.staff}`,
  slotTaken: "Bu saat az önce doldu. Hâlâ boş olan saatler:",
  noTimes: (d) => `${d} için boş saat kalmadı.`,
  noDays: "Önümüzdeki günlerde boş saat yok.",
  noStaff: "Bu hizmeti şu an veren kimse yok.",
  expired: "Bu talebin süresi doldu. Baştan alalım.",
  mineEmpty: "Yaklaşan randevunuz yok.",
  mineList: (lines) => `Yaklaşan randevularınız:\n${lines.join("\n")}`,
  cancelBody: "Hangi randevuyu iptal edeyim?",
  cancelButton: "Randevular",
  cancelAsk: (w) => `${w} iptal edilsin mi?`,
  cancelYes: "Evet, iptal et",
  cancelNo: "Vazgeç",
  cancelled: (w) => `İptal edildi: ${w}.`,
  notFound: "Bu randevuyu bulamadım.",
  keptIt: "Peki, hiçbir şey değişmedi.",
  textOnly: "Şimdilik yalnızca yazılı mesajları okuyabiliyorum. Yazabilir misiniz?",
  handedOff: "Mesajınızı ekibe ilettim. Birazdan buradan size dönecekler.",
  failed: "Kusura bakmayın, bir sorun oldu. Bir dakika sonra tekrar dener misiniz?",
  minutes: (n) => `${n} dk`,
  problem: (p, max) =>
    ({
      unknown_service: "Bu hizmeti tanımıyorum.",
      past_date: "Bu tarih geçmişte kaldı.",
      too_far: `En fazla ${max} gün sonrasına randevu verebiliyorum.`,
      closed: "O gün kapalıyız.",
      no_staff: "Bu hizmeti şu an veren kimse yok.",
    })[p],
};

export const strings = { en, tr } as const;
