import { createServer } from "node:http";
import { ZodError } from "zod";
import { appointmentRouteInput, publishAppointmentRoute } from "./appointment_routes.ts";
import { InfraiDnsClient, InfraiError } from "./infrai_dns.ts";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const client = new InfraiDnsClient(apiKey);
const port = Number(process.env.PORT ?? 3000);

function send(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/appointment-route") {
    send(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = appointmentRouteInput.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    const result = await publishAppointmentRoute(client, input);
    send(response, 200, result);
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      send(response, 400, { error: "Invalid request body" });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { error: error.code });
      return;
    }
    send(response, 502, { error: "Gateway request failed" });
  }
});

server.listen(port, () => {
  console.log(`Appointment DNS gateway listening on http://localhost:${port}`);
});
