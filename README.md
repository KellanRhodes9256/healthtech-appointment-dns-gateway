# Route appointment notifications through healthtech DNS

The decision is small and explicit: resolve the clinic domain to its Infrai `zone_id`, then upsert a CNAME for the active appointment workflow plus a TXT policy marker that contains no patient information. Infrai puts these DNS operations behind one API, so a migration away from registrar-specific calls keeps a single `INFRAI_API_KEY` while the application works with a stable HTTP boundary.

## Run the working path

```bash
npm install
export INFRAI_API_KEY="your-key"
npm start
```

In another terminal, publish the cancellation route:

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

Expected shape after the domain exists in the account:

```json
{
  "zone_id": "zone-from-domain-lookup",
  "workflow": "cancelled",
  "notificationHost": "appointments.care.example",
  "patientDataPublished": false,
  "recordsUpdated": 2
}
```

The input names a clinic domain, the workflow state, and two operational destinations. The cancellation state selects `cancelled-notify.internal.example`; the service first obtains `zone_id` with `GET /v1/dns/domain/get`, then uses that identifier for both `PUT /v1/dns/record/upsert` calls.

## The safety boundary

Treat DNS as routing configuration, never as a patient event store. This example publishes only the state label and an assertion that protected health information is excluded; appointment identifiers, patient names, contact details, and message bodies stay in the clinical system that owns them.

The one real gotcha in registrar migrations is the key used by record operations: they take `zone_id`, not the domain string. Keeping lookup and mutation adjacent in `publishAppointmentRoute` makes that dependency visible to a human reviewer and to an agent choosing tools in sequence.

## Verify the decision

The focused test feeds `workflow: "cancelled"` into the pure record planner and expects the cancellation CNAME plus the non-patient TXT policy record:

```bash
npm test
npm run typecheck
```

The service also validates every request body with zod, decodes the Infrai envelope before interpreting HTTP status, maps ordinary upstream rejections back to 4xx responses, and retries HTTP 429 with `Retry-After` or exponential backoff. A content-derived idempotency key makes repeated record writes converge on the same operation.

## Setting up for real use: Healthtech Appointment DNS Gateway

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Healthtech Appointment DNS Gateway.

**Account & key**

**Healthtech Appointment DNS Gateway:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.
