import type { Outgoing } from "./types.js";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Turns an `Outgoing` into a Cloud API request body, clipped to WhatsApp's
 * limits: 10 list rows, 3 buttons, 24-character row titles, 20-character
 * button titles. Over-long fields are cut instead of being rejected by Meta.
 */
export function toCloudPayload(to: string, out: Outgoing): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (out.kind === "text") return { ...base, type: "text", text: { body: clip(out.body, 4096) } };
  if (out.kind === "list")
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: clip(out.body, 1024) },
        action: {
          button: clip(out.button, 20),
          sections: [
            {
              rows: out.rows.slice(0, 10).map((r) => ({
                id: clip(r.id, 200),
                title: clip(r.title, 24),
                ...(r.description ? { description: clip(r.description, 72) } : {}),
              })),
            },
          ],
        },
      },
    };
  return {
    ...base,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: clip(out.body, 1024) },
      action: {
        buttons: out.buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: clip(b.id, 256), title: clip(b.title, 20) } })),
      },
    },
  };
}

export type WhatsAppClient = {
  send(to: string, out: Outgoing, phoneNumberId?: string): Promise<void>;
  /** Blue ticks plus a typing indicator while Claude thinks. Never throws. */
  markRead(messageId: string, phoneNumberId?: string): Promise<void>;
};

export function createWhatsAppClient(opts: { token: string; phoneNumberId: string; apiVersion?: string }): WhatsAppClient {
  const version = opts.apiVersion ?? "v23.0";
  const post = (phoneNumberId: string, body: unknown) =>
    fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  return {
    async send(to, out, phoneNumberId = opts.phoneNumberId) {
      const res = await post(phoneNumberId, toCloudPayload(to, out));
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`WhatsApp send failed (${res.status}): ${detail.slice(0, 300)}`);
      }
    },
    async markRead(messageId, phoneNumberId = opts.phoneNumberId) {
      await post(phoneNumberId, {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        typing_indicator: { type: "text" },
      }).catch(() => undefined);
    },
  };
}
