import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { toCloudPayload } from "../src/whatsapp/client.js";
import { parseWebhook, verifySignature } from "../src/whatsapp/webhook.js";

const webhook = (messages: unknown[], extra: Record<string, unknown> = {}) => ({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ field: "messages", value: {
    metadata: { phone_number_id: "PN1" },
    contacts: [{ wa_id: "905551112233", profile: { name: "Elif" } }],
    messages,
    ...extra,
  } }] }],
});

describe("parseWebhook", () => {
  it("reads text, taps and media, and ignores what needs no answer", () => {
    const [batch] = parseWebhook(webhook([
      { id: "w1", from: "905551112233", type: "text", text: { body: "  hi  " } },
      { id: "w2", from: "905551112233", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "svc:haircut", title: "Haircut" } } },
      { id: "w3", from: "905551112233", type: "audio", audio: {} },
      { id: "w4", from: "905551112233", type: "reaction", reaction: {} },
    ]));
    expect(batch!.phoneNumberId).toBe("PN1");
    expect(batch!.messages).toEqual([
      { messageId: "w1", from: "905551112233", name: "Elif", type: "text", text: "hi" },
      { messageId: "w2", from: "905551112233", name: "Elif", type: "tap", id: "svc:haircut", title: "Haircut" },
      { messageId: "w3", from: "905551112233", name: "Elif", type: "media", mediaType: "audio" },
    ]);
  });

  it("returns nothing for delivery receipts or junk", () => {
    expect(parseWebhook(webhook([], { statuses: [{ id: "w9", status: "read" }] }))).toEqual([]);
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook({ entry: "nope" })).toEqual([]);
  });
});

describe("verifySignature", () => {
  const body = JSON.stringify({ hello: "world" });
  const sign = (secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  it("accepts Meta's signature and rejects anything else", () => {
    expect(verifySignature(body, sign("s3cret"), "s3cret")).toBe(true);
    expect(verifySignature(body, sign("wrong"), "s3cret")).toBe(false);
    expect(verifySignature(body, "sha256=abc", "s3cret")).toBe(false);
    expect(verifySignature(body, undefined, "s3cret")).toBe(false);
  });
});

describe("toCloudPayload", () => {
  it("clips lists and buttons to WhatsApp's limits instead of letting Meta reject them", () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ id: `r${i}`, title: `A very long option title number ${i}` }));
    const list = toCloudPayload("1", { kind: "list", body: "Pick", button: "A button label that is too long", rows }) as any;
    expect(list.interactive.action.sections[0].rows).toHaveLength(10);
    expect(list.interactive.action.sections[0].rows[0].title.length).toBeLessThanOrEqual(24);
    expect(list.interactive.action.button.length).toBeLessThanOrEqual(20);

    const buttons = Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, title: `Button ${i}` }));
    const card = toCloudPayload("1", { kind: "buttons", body: "Sure?", buttons }) as any;
    expect(card.interactive.action.buttons).toHaveLength(3);
  });
});
