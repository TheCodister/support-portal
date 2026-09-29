# ADR 0001: Start with a modular monolith

- **Problem:** The ticket workflow needs strong consistency and tenant authorization without premature distributed coordination.
- **Evidence:** The initial modeled peak is 0.7 requests/second and all core writes share one transactional boundary.
- **Options:** Fastify modular monolith; separately deployed services; server actions writing directly to PostgreSQL.
- **Decision:** Keep business rules in one stateless Fastify service. Next.js uses the public API. PostgreSQL is authoritative, and attachment bytes bypass the API.
- **Consequences:** Simple transactions and deployment, with modules coupled at release time. Horizontal API scaling remains possible.
- **Verification:** Integration tests prove tenant and note visibility boundaries; k6 records the baseline.
- **Rollback:** The applications can be returned to one process without changing the schema or API contract.
