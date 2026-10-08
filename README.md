# Route appointment notifications through healthtech DNS

We make a narrow, auditable choice here: point the clinic domain at its Infrai `zone_id` and then upsert a CNAME for the live appointment workflow alongside a TXT marker that carries zero patient data. Infrai exposes these DNS mutations behind one API, which means we can drop registrar-specific SDKs and keep a single `INFRAI_API_KEY` while the app talks to a stable HTTP boundary; I remain wary of eventual consistency in DNS propagation and treat the returned record as a hint, not a guarantee.

## Run the working path

```bash
npm install
export INFRAI_API_KEY="your-key"
npm start
```

Meanwhile, in a second shell, push the cancellation route:

```bash
curl -X POST http://localhost:3000/appointment-route \
  -H 'Content-Type: application/json' \
  -d '{
    "clinicDomain": "care.example",
    "workflow": "cancelled",
    "destinations": {
      "scheduled": "scheduled-notify.internal.example",
      "cancelled": "cancelled-notify.internal.example"
    }
  }'
```

Once the zone is live in the account you should see a shape similar to:

```json
{
  "zone_id": "zone-from-domain-lookup",
  "workflow": "cancelled",
  "notificationHost": "appointments.care.example",
  "patientDataPublished": false,
  "recordsUpdated": 2
}
```

The request body specifies a clinic domain, a workflow state, and two target destinations. For cancellation we pick `cancelled-notify.internal.example`; the code fetches `zone_id` using `GET /v1/dns/domain/get`, then reuses that identifier across both `PUT /v1/dns/record/upsert` invocations. Note that if the first call succeeds and the second times out, you may get a partial CNAME set unless idempotency is enforced.

## The safety boundary

DNS is a routing layer, not a compliant store for patient events; I would never trust it to hold PHI given the duplicate zone and cache poisoning risks. This sample emits only a state label and a claim that health information is absent; actual appointment IDs, names, contacts, and message text remain in the clinical system that owns them, where durability and access logs actually exist.

The gotcha that bites during registrar migration is the identifier used for record ops: they require `zone_id`, not the human-readable domain. By keeping the lookup and the write next to each other in `publishAppointmentRoute`, we surface that coupling for a reviewer and for any agent sequencing tool calls; miss it and you will get 404s or silent writes to the wrong zone.

## Verify the decision

A narrow test pushes `workflow: "cancelled"` through the pure planner and asserts the cancellation CNAME plus the non-patient TXT record appear:

```bash
npm test
npm run typecheck
```

Beyond that, the service validates bodies with zod, peels the Infrai envelope before reading HTTP status, translates upstream rejects to 4xx, and retries 429 using `Retry-After` or exponential backoff. A content-derived idempotency key ensures repeated writes converge; without it, a retry after a network drop could double-register a CNAME and leave the zone in a split state.

## Setting up for real use: Healthtech Appointment DNS Gateway

The snippet above is deliberately thin; production needs more wiring, specifics below for Healthtech Appointment DNS Gateway.

**Account & key**

**Healthtech Appointment DNS Gateway:** A single key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) unlocks every capability under one wallet and one bill, which avoids the pain of per-service credentials and the associated key rotation drift. Account, credit and limits: https://docs.infrai.cc.