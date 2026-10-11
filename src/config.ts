import { readFileSync } from "node:fs";
import { z } from "zod";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use HH:MM, 24-hour");
/** Opening hours for one day. `null` means closed. */
const day = z.tuple([hhmm, hhmm]).nullable();
const week = z.object({ mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day });
const id = z.string().regex(/^[a-z0-9-]+$/, "use lowercase letters, digits and dashes");

export const BusinessSchema = z
  .object({
    name: z.string().min(1),
    assistantName: z.string().min(1).default("Assistant"),
    language: z.enum(["en", "tr"]).default("en"),
    timezone: z.string().default("UTC"),
    currency: z.string().length(3).optional(),
    slotStepMinutes: z.number().int().positive().default(15),
    minLeadMinutes: z.number().int().min(0).default(60),
    maxLeadDays: z.number().int().positive().max(60).default(14),
    hours: week,
    services: z
      .array(
        z.object({
          id,
          name: z.string().min(1),
          minutes: z.number().int().positive(),
          price: z.number().nonnegative().optional(),
          description: z.string().optional(),
        }),
      )
      .min(1),
    staff: z
      .array(
        z.object({
          id,
          name: z.string().min(1),
          services: z.array(id).min(1),
          /** Personal hours. Defaults to the business hours. */
          hours: week.optional(),
        }),
      )
      .min(1),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
    /** Extra rules for the assistant, written by the business owner. */
    instructions: z.string().optional(),
  })
  .superRefine((b, ctx) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: b.timezone });
    } catch {
      ctx.addIssue({ code: "custom", path: ["timezone"], message: `unknown time zone "${b.timezone}"` });
    }
    const serviceIds = new Set(b.services.map((s) => s.id));
    if (serviceIds.size !== b.services.length)
      ctx.addIssue({ code: "custom", path: ["services"], message: "service ids must be unique" });
    if (new Set(b.staff.map((s) => s.id)).size !== b.staff.length)
      ctx.addIssue({ code: "custom", path: ["staff"], message: "staff ids must be unique" });
    b.staff.forEach((m, i) =>
      m.services.forEach((s) => {
        if (!serviceIds.has(s))
          ctx.addIssue({ code: "custom", path: ["staff", i, "services"], message: `unknown service "${s}"` });
      }),
    );
  });

export type Business = z.infer<typeof BusinessSchema>;
export type Service = Business["services"][number];
export type StaffMember = Business["staff"][number];
export type Week = z.infer<typeof week>;
export type DayKey = keyof Week;

export function parseBusiness(input: unknown): Business {
  const result = BusinessSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid business config:\n${lines.join("\n")}`);
  }
  return result.data;
}

export function loadBusiness(path: string): Business {
  return parseBusiness(JSON.parse(readFileSync(path, "utf8")));
}
