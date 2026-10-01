import assert from "node:assert/strict";
import test from "node:test";
import { chooseAppointmentRecords } from "../src/appointment_routes.ts";

test("a cancelled appointment selects the cancellation destination without publishing patient data", () => {
  const records = chooseAppointmentRecords({
    clinicDomain: "care.example",
    workflow: "cancelled",
    destinations: {
      scheduled: "scheduled-notify.internal.example",
      cancelled: "cancelled-notify.internal.example",
    },
  });

  assert.deepEqual(records, [
    {
      record_type: "CNAME",
      name: "appointments",
      content: "cancelled-notify.internal.example",
      ttl: 300,
      metadata: { purpose: "appointment-notifications", workflow: "cancelled" },
    },
    {
      record_type: "TXT",
      name: "_appointment-policy",
      content: "workflow=cancelled;phi=excluded",
      ttl: 300,
      metadata: { purpose: "patient-safety-policy", workflow: "cancelled" },
    },
  ]);
});
