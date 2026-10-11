import { existsSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { loadBusiness } from "./config.js";
import { createEngine, type EngineOptions } from "./engine.js";
import { createMemoryStore } from "./store/memory.js";
import { createSupabaseStore } from "./store/supabase.js";

/** Reads `.env` if there is one, then builds the engine from environment variables. */
export function engineFromEnv(overrides: Partial<EngineOptions> = {}) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const env = process.env;

  const business = loadBusiness(env.BUSINESS_FILE ?? "examples/salon.json");

  const store =
    env.STORE === "supabase"
      ? createSupabaseStore({ url: required("SUPABASE_URL"), serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY") })
      : createMemoryStore();

  const hasKey = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
  const client = hasKey ? new Anthropic({ timeout: 60_000, maxRetries: 1 }) : null;
  const effort = (env.CLAUDE_EFFORT ?? "low") as "low" | "medium" | "high";

  const engine = createEngine({
    business,
    store,
    agent: client
      ? { create: (params) => client.beta.messages.create(params), model: env.CLAUDE_MODEL ?? "claude-opus-5-5", effort }
      : undefined,
    ...overrides,
  });
  return { engine, business, store, aiEnabled: Boolean(client), storeKind: env.STORE === "supabase" ? "supabase" : "memory" };
}

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}
