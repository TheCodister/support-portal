# SupportDesk

A multi-tenant support platform built as a modular monolith with a Next.js frontend, Fastify API, PostgreSQL, private S3-compatible attachments, an admin-authored knowledge base (Tiptap editor with Markdown paste; images in the same private bucket), and a durable outbox worker. AWS CDK definitions deploy the frontend to Amplify Hosting and the container workloads to ECS Fargate. LocalStack emulates private S3 locally.

## Local quick start

Requirements: Node 24+, pnpm 10+, and Docker.

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open http://localhost:3000 and sign in as `admin@acme.test`, `agent@acme.test`, or `requester@acme.test`; every seeded account uses `supportdesk-demo`. A second tenant is available as `admin@globex.test` to verify isolation.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build` before release. See [docs/operations.md](docs/operations.md) for deployment, rollback, backup restore, and failure exercises.
