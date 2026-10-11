/** A message the customer sent us, already parsed out of the webhook. */
export type Inbound = {
  /** WhatsApp message id ("wamid..."), used to skip re-deliveries. */
  messageId: string | null;
  from: string;
  /** Profile name from WhatsApp, when the customer has one. */
  name: string | null;
} & (
  | { type: "text"; text: string }
  /** A tap on a list row or reply button. `id` is the id we gave that option. */
  | { type: "tap"; id: string; title: string }
  /** Image, voice note, location... We tell the customer we read text only. */
  | { type: "media"; mediaType: string }
);

export type ListRow = { id: string; title: string; description?: string };

/** A message we send. Lists and buttons are WhatsApp's native interactive messages. */
export type Outgoing =
  | { kind: "text"; body: string }
  | { kind: "list"; body: string; button: string; rows: ListRow[] }
  | { kind: "buttons"; body: string; buttons: { id: string; title: string }[] };
