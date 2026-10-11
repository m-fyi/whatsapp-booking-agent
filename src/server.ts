import Fastify from "fastify";
import { engineFromEnv, required } from "./setup.js";
import { createWhatsAppClient } from "./whatsapp/client.js";
import { parseWebhook, verifySignature } from "./whatsapp/webhook.js";

const { engine, business, aiEnabled, storeKind } = engineFromEnv({
  onHandoff: (convo, reason) => console.warn(`[handoff] ${convo.phone} (${convo.name ?? "no name"}): ${reason}`),
});

const env = process.env;
const verifyToken = required("WHATSAPP_VERIFY_TOKEN");
const appSecret = env.WHATSAPP_APP_SECRET;
if (!appSecret && env.ALLOW_UNSIGNED_WEBHOOKS !== "1")
  throw new Error("Set WHATSAPP_APP_SECRET so webhooks are verified (or ALLOW_UNSIGNED_WEBHOOKS=1 for local testing only).");

const whatsapp = createWhatsAppClient({
  token: required("WHATSAPP_TOKEN"),
  phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
  apiVersion: env.GRAPH_API_VERSION,
});

const app = Fastify({ logger: true });

// Keep the raw body: the signature is computed over the exact bytes Meta sent.
app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));

app.get("/health", async () => ({ ok: true, business: business.name, ai: aiEnabled, store: storeKind }));

// Meta calls this once when you register the webhook URL.
app.get("/webhook", async (req, reply) => {
  const q = req.query as Record<string, string | undefined>;
  if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === verifyToken) return reply.type("text/plain").send(q["hub.challenge"]);
  return reply.code(403).send();
});

app.post("/webhook", async (req, reply) => {
  const raw = req.body as string;
  if (appSecret && !verifySignature(raw, req.headers["x-hub-signature-256"] as string | undefined, appSecret))
    return reply.code(401).send();

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply.code(400).send();
  }

  // Answer Meta at once; it retries slow webhooks. The work continues below.
  reply.code(200).send();

  for (const batch of parseWebhook(body)) {
    for (const msg of batch.messages) {
      const phoneNumberId = batch.phoneNumberId ?? undefined;
      void (async () => {
        if (msg.messageId && msg.type === "text") await whatsapp.markRead(msg.messageId, phoneNumberId);
        const out = await engine.handle(msg);
        for (const o of out) await whatsapp.send(msg.from, o, phoneNumberId);
      })().catch((error) => app.log.error({ err: error, from: msg.from }, "failed to answer a WhatsApp message"));
    }
  }
});

const port = Number(env.PORT ?? 3000);
await app.listen({ port, host: "0.0.0.0" });
app.log.info(`${business.name}: webhook ready on :${port}/webhook (AI ${aiEnabled ? "on" : "off"}, ${storeKind} store)`);
