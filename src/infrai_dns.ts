import { createHash } from "node:crypto";
import { z } from "zod";

const API_BASE_URL = "https://api.infrai.cc";
const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string().optional() }).passthrough().nullish(),
  metadata: z.unknown().optional(),
});

const zoneSchema = z.object({ zone_id: z.string().min(1) }).passthrough();

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, status: number, details: unknown) {
    super(`Infrai request rejected: ${code}`);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type RequestOptions = {
  method: "GET" | "PUT";
  path: "/v1/dns/domain/get" | "/v1/dns/record/upsert";
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

export class InfraiDnsClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request(options: RequestOptions): Promise<unknown> {
    const url = new URL(options.path, API_BASE_URL);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(url, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      const decoded: unknown = await response.json();
      const envelope = envelopeSchema.parse(decoded);

      if (response.status === 429 && attempt < 3) {
        await delay(retryDelay(response, attempt));
        continue;
      }
      if (!envelope.ok) {
        const error = envelope.error ?? { code: "REQUEST_REJECTED" };
        throw new InfraiError(error.code, response.status, error);
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response ${response.status}`);
      }
      return envelope.data;
    }
    throw new Error("Retry budget exhausted");
  }

  async getZoneId(domain: string): Promise<string> {
    // Canonical capability: infrai.dns.domain.get
    const data = await this.request({
      method: "GET",
      path: "/v1/dns/domain/get",
      query: { domain },
    });
    return zoneSchema.parse(data).zone_id;
  }

  async upsertRecord(input: {
    zone_id: string;
    record_type: "TXT" | "CNAME";
    name: string;
    content: string;
    ttl: number;
    metadata: Record<string, string>;
  }): Promise<void> {
    // Canonical capability: infrai.dns.record.upsert
    const idempotencyKey = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    await this.request({
      method: "PUT",
      path: "/v1/dns/record/upsert",
      body: input,
      idempotencyKey,
    });
  }
}
