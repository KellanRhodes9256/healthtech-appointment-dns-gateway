import { z } from "zod";
import type { InfraiDnsClient } from "./infrai_dns.ts";

export const appointmentRouteInput = z.object({
  clinicDomain: z.string().min(1),
  workflow: z.enum(["scheduled", "cancelled"]),
  destinations: z.object({
    scheduled: z.string().min(1),
    cancelled: z.string().min(1),
  }),
});

export type AppointmentRouteInput = z.infer<typeof appointmentRouteInput>;

export function chooseAppointmentRecords(input: AppointmentRouteInput) {
  const destination = input.destinations[input.workflow];
  return [
    {
      record_type: "CNAME" as const,
      name: "appointments",
      content: destination,
      ttl: 300,
      metadata: { purpose: "appointment-notifications", workflow: input.workflow },
    },
    {
      record_type: "TXT" as const,
      name: "_appointment-policy",
      content: `workflow=${input.workflow};phi=excluded`,
      ttl: 300,
      metadata: { purpose: "patient-safety-policy", workflow: input.workflow },
    },
  ];
}

export async function publishAppointmentRoute(client: InfraiDnsClient, input: AppointmentRouteInput) {
  const zone_id = await client.getZoneId(input.clinicDomain);
  const records = chooseAppointmentRecords(input);
  for (const record of records) {
    await client.upsertRecord({ zone_id, ...record });
  }
  return {
    zone_id,
    workflow: input.workflow,
    notificationHost: `appointments.${input.clinicDomain}`,
    patientDataPublished: false,
    recordsUpdated: records.length,
  };
}
