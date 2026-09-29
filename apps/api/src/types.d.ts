import type { Role } from "@supportdesk/contracts";

declare module "fastify" {
  interface FastifyRequest {
    auth: { userId: string; organizationId: string; role: Role };
  }
}
