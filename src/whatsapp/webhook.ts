import { createHmac, timingSafeEqual } from "node:crypto";
import type { Inbound } from "./types.js";

export type WebhookBatch = { phoneNumberId: string | null; messages: Inbound[] };

const MEDIA = new Set(["image", "audio", "video", "document", "location", "contacts", "sticker"]);

type RawMessage = {
  id?: string;
  from: string;
  type: string;
  text?: { body?: string };
  interactive?: { list_reply?: { id: string; title?: string }; button_reply?: { id: string; title?: string } };
};

/**
 * Pulls customer messages out of a WhatsApp Cloud API webhook body.
 * Delivery receipts (`statuses`) and reactions are ignored on purpose.
 */
export function parseWebhook(body: unknown): WebhookBatch[] {
  const out: WebhookBatch[] = [];
  const entries = (body as { entry?: { changes?: { value?: Record<string, unknown> }[] }[] } | null)?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const phoneNumberId = (value.metadata as { phone_number_id?: string } | undefined)?.phone_number_id ?? null;
      const contacts = (value.contacts ?? []) as { wa_id: string; profile?: { name?: string } }[];
      const names = new Map(contacts.map((c) => [c.wa_id, c.profile?.name ?? null]));
      const messages: Inbound[] = [];

      for (const m of (value.messages ?? []) as RawMessage[]) {
        const base = { messageId: m.id ?? null, from: m.from, name: names.get(m.from) ?? null };
        if (m.type === "text" && m.text?.body?.trim()) {
          messages.push({ ...base, type: "text", text: m.text.body.trim() });
        } else if (m.type === "interactive") {
          const reply = m.interactive?.list_reply ?? m.interactive?.button_reply;
          if (reply?.id) messages.push({ ...base, type: "tap", id: reply.id, title: reply.title?.trim() || reply.id });
        } else if (MEDIA.has(m.type)) {
          messages.push({ ...base, type: "media", mediaType: m.type });
        }
      }
      if (messages.length) out.push({ phoneNumberId, messages });
    }
  }
  return out;
}

/** Checks Meta's `X-Hub-Signature-256` header against the raw request body. */
export function verifySignature(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const got = Buffer.from(header.slice("sha256=".length), "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}
