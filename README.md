# SupportDesk

A multi-tenant customer-support platform, built as a **system-design learning project**: start with the smallest architecture that is correct, measure it, and only add moving parts when evidence says a stage has outgrown it.

SupportDesk is a **modular monolith**: a Next.js frontend, one stateless Fastify API, PostgreSQL as the source of truth, private S3 for file bytes, and a durable outbox worker for background jobs. AWS CDK deploys the frontend to Amplify Hosting and the containers to ECS Fargate. GitHub Actions deploys every merge to `main` using short-lived OIDC credentials, with no stored AWS keys.

> The long-form design rationale, capacity model, and stage-by-stage scaling roadmap live in [`supportdesk-system-design-plan.md`](supportdesk-system-design-plan.md). Operational runbooks live in [`docs/operations.md`](docs/operations.md). This README is the map that connects them to the code.

---

## Table of contents

1. [Features](#features)
2. [Tech stack](#tech-stack)
3. [Repository layout](#repository-layout)
4. [Architecture](#architecture)
   - [Logical architecture](#logical-architecture)
   - [AWS deployment architecture](#aws-deployment-architecture)
   - [Network and security groups](#network-and-security-groups)
   - [Request lifecycle](#request-lifecycle)
   - [File uploads (attachments and images)](#file-uploads-attachments-and-images)
   - [Rich text and embedded images](#rich-text-and-embedded-images)
   - [Outbox and background jobs](#outbox-and-background-jobs)
5. [Multi-tenancy, authentication and authorization](#multi-tenancy-authentication-and-authorization)
6. [Data model](#data-model)
7. [API reference](#api-reference)
8. [Local development](#local-development)
9. [Configuration](#configuration)
10. [Testing](#testing)
11. [CI/CD](#cicd)
12. [Infrastructure (AWS CDK)](#infrastructure-aws-cdk)
13. [Release, rollback and migrations](#release-rollback-and-migrations)
14. [Observability and operations](#observability-and-operations)
15. [Capacity model and scaling roadmap](#capacity-model-and-scaling-roadmap)
16. [Architecture decisions](#architecture-decisions)
17. [Known limitations](#known-limitations)

---

## Features

| Area | What it does |
|---|---|
| **Organizations (tenants)** | Each user can belong to several organizations, with a role per organization: `requester`, `agent`, or `admin`. All data is scoped to an organization. |
| **Tickets** | Create, list, filter (status, priority, assignee), full-text search, cursor pagination, assign, and change status or priority with optimistic concurrency (`version`). |
| **Conversation** | Public replies and agent-only **internal notes**. Requesters never see internal notes or anything attached to them. |
| **Rich text** | Ticket descriptions, replies and notes are written in a Tiptap editor and stored as Markdown. Pasting Markdown is detected and converted. |
| **Images** | Images pasted or dropped into the editor are uploaded to private S3 and referenced by ID, never by an outside URL. |
| **Attachments** | Files up to 10 MB, uploaded straight from the browser to S3 through presigned POSTs and downloaded through short-lived presigned URLs. |
| **Knowledge base** | Admin-authored articles with images, full-text search, and optimistic concurrency. Every member of the organization can read them. |
| **Announcements** | Admins post **news** (green), **maintenance** (amber) or **incident** (red) announcements with an optional end time. Active ones show as color-coded banners across the workspace, most severe first; each member can dismiss one, and an edit shows it again. |
| **Inbox notice** | One notice per organization pinned to the top of the tickets inbox: **Released** (green), **Maintenance** (amber) or **Incident** (red). Members cannot dismiss it; admins change or clear it. |
| **Audit trail** | Every ticket, comment, article, announcement and notice change writes an `audit_events` row in the same transaction. Agents see it as the ticket's activity. |
| **Background events** | Ticket and comment changes write a transactional **outbox** event. A worker publishes it to SQS, and an idempotent consumer handles it. |

Seeded demo tenants: **Acme** (admin, agent, requester) and **Globex** (admin). Globex exists to prove tenant isolation.

---

## Tech stack

<details>
<summary>Libraries and services by layer</summary>

| Layer | Technology |
|---|---|
| Monorepo | pnpm 10 workspaces, TypeScript 5.9 (strict, `noUncheckedIndexedAccess`), Node 24 |
| Frontend | Next.js 15 (App Router, React 19), Tiptap 3 (`starter-kit`, `image`, `markdown`) |
| API | Fastify 5, Zod 4, `@fastify/cookie`, `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit` |
| Shared contracts | `@supportdesk/contracts`: Zod schemas and enums used by both API and web |
| Database | PostgreSQL 17 through `pg`, plain SQL migrations, a custom migration runner |
| Object storage | Amazon S3 (LocalStack 3.8 locally) through the AWS SDK v3 presigners |
| Queue | Amazon SQS with a dead-letter queue |
| Worker | Node process with `publisher` and `consumer` modes |
| Infrastructure | AWS CDK v2: VPC, ECS Fargate (ARM64), ALB, API Gateway HTTP API + VPC Link, RDS, S3, SQS, ECR, Secrets Manager, CloudWatch, EventBridge Scheduler |
| Frontend hosting | AWS Amplify Hosting |
| CI/CD | GitHub Actions with OIDC federation to AWS |
| Testing | Vitest (API), `node:test` (web), k6 (load) |

</details>

---

## Repository layout

<details>
<summary>Directory tree and workspace dependencies</summary>

```text
.
├── apps/
│   ├── api/                 Fastify API: routes, authorization, business rules
│   │   ├── src/app.ts         every route, the auth and CSRF hooks, the error handler
│   │   ├── src/security.ts    session token generation and hashing, scrypt password check
│   │   ├── src/markdown.ts    allow-list for images embedded in ticket Markdown
│   │   ├── src/server.ts      process entry point and graceful shutdown
│   │   ├── test/              unit tests and DB-backed integration tests
│   │   └── Dockerfile         multi-stage ARM64 image, bundles the RDS CA
│   ├── web/                 Next.js client (one page, runs entirely in the browser)
│   │   ├── app/desk.tsx       sign-in, organization switcher, inbox, ticket detail
│   │   ├── app/knowledge.tsx  knowledge-base list, reader and editor
│   │   ├── app/announcements.tsx, announcement-banners.tsx, announcement-kinds.ts   announcement view, workspace banners, kind colors and banner rules
│   │   ├── app/home-notice.tsx  the pinned inbox notice and its admin form
│   │   ├── app/rich-text-editor.tsx, ticket-editors.tsx, article-editor.tsx   Tiptap editors
│   │   ├── app/rich-content.ts  image reference rewriting and Markdown detection
│   │   ├── app/api.ts, request-headers.ts   fetch wrapper (CSRF and organization headers)
│   │   └── test/              node:test unit tests
│   └── worker/              Outbox publisher and SQS consumer
├── packages/
│   ├── contracts/           Shared Zod schemas, roles, statuses, priorities
│   └── database/            pg pool, transaction helper, SQL migrations, migrate and seed scripts
├── infra/                   AWS CDK app
│   ├── bin/app.ts             stack wiring and context flags
│   └── lib/
│       ├── supportdesk-stack.ts     the application stack
│       ├── github-deploy-stack.ts   GitHub OIDC provider and least-privilege deploy role
│       └── demo-expiry-stack.ts     scheduled self-deletion of the learning demo
├── .github/workflows/
│   ├── verify.yml           test, typecheck, build (pull requests and branches)
│   └── deploy.yml           verify, preflight, api, web, smoke (push to main)
├── docker/localstack/       LocalStack init script (bucket and CORS)
├── docker-compose.yml       Local PostgreSQL 17 and LocalStack S3
├── load-tests/baseline.js   k6 arrival-rate baseline
├── amplify.yml              Amplify build spec for Git-connected (SSR) hosting
├── docs/
│   ├── decisions/           Architecture decision records
│   ├── operations.md        Deployment, rollback, restore and failure exercises
│   └── benchmarks/          Load-test and failure-exercise results
└── supportdesk-system-design-plan.md   Full design and scaling plan
```

Workspace dependency graph:

```mermaid
graph LR
  web["@supportdesk/web"] --> contracts["@supportdesk/contracts"]
  api["@supportdesk/api"] --> contracts
  api --> database["@supportdesk/database"]
  worker["@supportdesk/worker"] --> database
  infra["@supportdesk/infra"]
```

</details>

---

## Architecture

### Logical architecture

<details>
<summary>Diagram: browser, API modules, PostgreSQL, S3 and the outbox</summary>

One stateless API owns every business rule. The browser talks only to the API (JSON) and to S3 (file bytes, through presigned URLs). PostgreSQL is authoritative. The outbox makes side effects durable without a distributed transaction.

```mermaid
flowchart LR
  subgraph Browser
    UI["Next.js SPA<br/>(Desk + Knowledge base + Announcements)"]
  end

  subgraph API["Fastify API (stateless)"]
    direction TB
    MW["Hooks: CORS · Helmet · rate limit<br/>CSRF check · error handler"]
    AUTH["authenticate()<br/>session + membership + role"]
    MODS["Modules<br/>auth · members · tickets · comments<br/>attachments · ticket images · knowledge · announcements · notice"]
    MW --> AUTH --> MODS
  end

  subgraph Data
    PG[("PostgreSQL<br/>tickets, comments, audit,<br/>outbox_events, job_executions")]
    S3[("Private S3 bucket<br/>attachments + images")]
  end

  subgraph Async["Background (stage 2)"]
    PUB["Worker: publisher"]
    Q[["SQS Jobs"]]
    DLQ[["SQS DLQ"]]
    CON["Worker: consumer"]
  end

  UI -- "JSON + cookies<br/>x-csrf-token, x-organization-id" --> MW
  UI -- "presigned POST / GET<br/>(bytes bypass the API)" --> S3
  MODS -- "one transaction:<br/>row + audit + outbox" --> PG
  MODS -- "presign, HeadObject" --> S3
  PUB -- "poll unpublished" --> PG
  PUB -- SendMessage --> Q
  Q --> CON
  Q -. "after 5 receives" .-> DLQ
  CON -- "claim job_id (idempotent)" --> PG
```

Design principles enforced in code:

- **Tenant isolation in every query.** Each table carries `organization_id`, and composite foreign keys (`(organization_id, x_id)`) make cross-tenant references impossible at the schema level.
- **Bytes never pass through the API.** The API allocates a row and a presigned POST, the browser uploads to S3, and the API verifies the object with `HeadObject` before marking it `available`.
- **Side effects are transactional.** The domain row, its `audit_events` row and its `outbox_events` row commit or roll back together.
- **Optimistic concurrency.** Ticket and article updates require the current `version`. A stale write gets `409 version_conflict`.
- **Keyset pagination.** Cursors encode `(created_at, id)` (or `updated_at` for articles) and are backed by matching composite indexes.

</details>

### AWS deployment architecture

<details>
<summary>Diagram and resource list</summary>

The learning environment has no custom domain. It reaches the API through **Amplify on the same origin** (`/api/*`), which forwards to an **API Gateway HTTP API**, then a **VPC Link**, then an **internal ALB** in front of the Fargate API. When a `certificateArn` is supplied, the stack instead makes the ALB internet-facing with HTTPS and drops API Gateway.

```mermaid
flowchart TB
  user(("User browser"))

  subgraph GH["GitHub"]
    repo["support-portal repo"]
    gha["GitHub Actions"]
  end

  subgraph AWS["AWS account · us-east-1"]
    amplify["Amplify Hosting<br/>static Next.js export<br/>/api/* → API Gateway"]
    apigw["API Gateway HTTP API"]

    subgraph VPC["VPC · 2 AZs · no NAT gateways"]
      subgraph PUB["Public subnets"]
        vpclink["VPC Link"]
        alb["Application Load Balancer<br/>(internal, HTTP:80)"]
        api1["ECS Fargate · API task<br/>ARM64 · 0.5 vCPU / 1 GB<br/>:4000"]
        workers["ECS Fargate · worker services<br/>OutboxPublisher / JobConsumer<br/>(desired 0 until enableWorkers)"]
        migrate["One-off ECS tasks<br/>Migrate · Maintenance (seed)"]
      end
      subgraph ISO["Private isolated subnets"]
        rds[("RDS PostgreSQL 17<br/>db.t4g.micro · encrypted<br/>7-day backups")]
      end
    end

    s3[("S3 attachments bucket<br/>private · SSE-S3 · TLS only")]
    sqs[["SQS Jobs → DLQ"]]
    ecr["ECR<br/>api + worker repos<br/>scan on push"]
    sm["Secrets Manager<br/>DB credentials · demo password"]
    cw["CloudWatch Logs<br/>+ ALB 5xx alarm"]
    sched["EventBridge Scheduler<br/>(demo expiry)"]
    oidc["IAM OIDC provider<br/>+ DeployRole"]
  end

  user -- HTTPS --> amplify
  user -- "presigned upload/download" --> s3
  amplify -- "/api/*" --> apigw --> vpclink --> alb --> api1
  api1 --> rds
  api1 --> s3
  workers --> rds
  workers --> sqs
  migrate --> rds
  api1 -. secrets .-> sm
  api1 -. logs .-> cw
  ecr -. image .-> api1
  repo --> gha
  gha -- "OIDC AssumeRoleWithWebIdentity" --> oidc
  gha -- "push image" --> ecr
  gha -- "cdk deploy · run-task" --> VPC
  gha -- "manual zip deployment" --> amplify
  sched -. "delete at expiry" .-> amplify
  sched -. "delete stack" .-> VPC
```

> **Note:** the Amplify rewrite from `/api/<*>` to the API Gateway URL is set on the Amplify app itself (app settings → rewrites and redirects). It is not defined in this repository. The deploy workflow builds the frontend with `NEXT_PUBLIC_API_URL=/api` and its smoke test calls `${WEB_ORIGIN}/api/health/ready`, so the rewrite must exist.

**Learning vs production stage** (`-c stage=production` switches these in `supportdesk-stack.ts`):

| Concern | `learning` (default) | `production` |
|---|---|---|
| API tasks (min/max) | 1 / 1 | 2 / 4, CPU target 60 % |
| RDS | `db.t4g.micro`, single-AZ, no deletion protection, destroyed with the stack | `m5.large`, Multi-AZ, deletion protection, snapshot on removal |
| S3 | auto-delete objects, destroyed with the stack | versioned, retained |
| ECR | emptied and destroyed with the stack | retained |
| Container Insights | disabled | enhanced |
| Demo password secret and maintenance (seed) task | created | not created |
| Rolling deploy | `minHealthyPercent` 0 (brief restart downtime) | 50 % |

</details>

### Network and security groups

<details>
<summary>Security groups and allowed ports</summary>

```mermaid
flowchart LR
  internet(("Internet"))
  vpcl["VPC Link SG"]
  albsg["ALB SG"]
  apisg["API SG<br/>(API, workers, migrate tasks)"]
  dbsg["Database SG<br/>(no outbound)"]

  internet -- "443, only when certificateArn is set" --> albsg
  vpcl -- "80, no-certificate mode" --> albsg
  albsg -- 4000 --> apisg
  apisg -- 5432 --> dbsg
```

- Fargate tasks run in **public subnets with public IPs** so they can reach ECR, S3, SQS and Secrets Manager **without a NAT gateway** (a cost decision for the learning stage). Their security group accepts application traffic **only from the ALB**.
- RDS lives in **private isolated subnets**, accepts only the API security group on 5432, requires TLS, and the API verifies the server certificate against the bundled RDS CA (`NODE_EXTRA_CA_CERTS`, `rejectUnauthorized: true`).
- The S3 bucket blocks all public access, enforces TLS, and allows CORS only from `webOrigin`.

</details>

### Request lifecycle

<details>
<summary>Sequence diagram of an authenticated request</summary>

Every authenticated request carries the session cookie, the `x-organization-id` header, and, for mutations, `x-csrf-token`.

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant F as Fastify
  participant DB as PostgreSQL

  B->>F: PATCH /v1/tickets/:id (cookie, x-organization-id, x-csrf-token, {version, status})
  F->>F: onRequest: rate limit (300/min default)
  F->>F: onRequest: CSRF header must equal CSRF cookie
  F->>DB: SELECT session ⨝ membership WHERE token_hash = sha256(cookie) AND org = header AND not expired
  DB-->>F: user_id, role
  F->>F: requireAgent() and Zod validation
  F->>DB: BEGIN
  F->>DB: UPDATE tickets … WHERE organization_id AND id AND version = $v RETURNING *
  alt no row returned
    F->>DB: SELECT ticket exists?
    F-->>B: 409 version_conflict / 404 not_found
  else updated
    F->>DB: INSERT audit_events ('ticket.updated')
    F->>DB: INSERT outbox_events ('ticket.updated')
    F->>DB: COMMIT
    F-->>B: 200 updated ticket
  end
```

Errors always have the shape `{ error, message, requestId }`. Zod failures map to `400 validation_error`. Status 5xx is logged with the error and returned as a generic `Internal server error`. `x-request-id` is honoured as the request ID.

</details>

### File uploads (attachments and images)

<details>
<summary>Allocate, upload, complete protocol and object keys</summary>

Attachments, ticket images and knowledge images all follow the same **allocate → upload → complete** protocol.

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as API
  participant DB as PostgreSQL
  participant S as S3

  B->>A: POST /v1/tickets/:id/attachments {fileName, contentType, sizeBytes}
  A->>A: authorize the ticket (requesters: own ticket, public comment only)
  A->>DB: INSERT attachments (state = 'pending', key = org/ticket/uuid)
  A->>S: createPresignedPost (10 min, exact content-length, exact Content-Type)
  A-->>B: 201 {attachmentId, upload: {url, fields}}
  B->>S: POST multipart form (fields + file)
  S-->>B: 204
  B->>A: POST /v1/attachments/:id/complete
  A->>S: HeadObject
  A->>A: ContentLength and ContentType must match the allocation
  A->>DB: UPDATE state = 'available'
  A-->>B: {state: 'available'}
  Note over B,S: Download: GET /v1/attachments/:id/download returns a 5-minute presigned GET with Content-Disposition: attachment
```

| Kind | Object key | Max size | Allowed types | Who may upload |
|---|---|---|---|---|
| Attachment | `{org}/{ticket}/{uuid}` | 10 MB | any | anyone who can see the ticket |
| Ticket image | `{org}/ticket-images/{uuid}` | 5 MB | PNG, JPEG, GIF, WebP | any member |
| Knowledge image | `{org}/knowledge/{uuid}` | 5 MB | PNG, JPEG, GIF, WebP | admins |

Incomplete multipart uploads are aborted by an S3 lifecycle rule after one day.

</details>

### Rich text and embedded images

<details>
<summary>How Markdown and image references are stored</summary>

Markdown is stored with **origin-independent image references**, so the stored text does not depend on where the API is hosted:

```text
![diagram](ticket-image:3f2c…-uuid)      ← stored in PostgreSQL
![diagram](https://…/api/v1/ticket-images/3f2c…-uuid)   ← what the editor sees
```

- `rich-content.ts` converts between the two forms (`toEditorMarkdown` and `toStoredMarkdown`) for both the `kb-image:` and `ticket-image:` schemes.
- The API's `ticketImageIds()` (`apps/api/src/markdown.ts`) **rejects** any ticket or comment Markdown that contains raw `<img>`, reference-style images, or any image source that is not `ticket-image:<uuid>`. A requester therefore cannot make an agent's browser load an outside URL (a tracking pixel or SSRF-style probe).
- On create, referenced images are **linked inside the same transaction** (`UPDATE ticket_images SET ticket_id … WHERE uploader_id = me AND ticket_id IS NULL AND state = 'available'`). If the row count differs, the whole ticket or comment is rejected, so an image can be used only once and only by its uploader.
- `GET /v1/ticket-images/:id` and `GET /v1/knowledge/images/:id` are reached from `<img>` tags, which cannot send the organization header. They authorize from the **session alone**, checked against the image's own organization, then `302` redirect to a 5-minute presigned URL (`cache-control: private, max-age=240`).
- Visibility rules for ticket images: before it is saved, only the uploader can see an image. Afterwards, agents and admins can see it, and so can the ticket's requester unless the image belongs to an internal note.

</details>

### Outbox and background jobs

<details>
<summary>Outbox, SQS and idempotent consumer flow</summary>

```mermaid
sequenceDiagram
  autonumber
  participant API
  participant DB as PostgreSQL
  participant P as Worker (publisher)
  participant Q as SQS Jobs
  participant C as Worker (consumer)

  API->>DB: COMMIT ticket + audit + outbox_events row
  loop every ~1s when idle
    P->>DB: SELECT unpublished, available_at <= now() LIMIT 20
    P->>Q: SendMessage {id, type, organizationId, aggregateId, payload}
    alt success
      P->>DB: published_at = now()
    else failure
      P->>DB: attempts += 1, last_error, available_at = now() + min(attempts, 10) × 10s
    end
  end
  C->>Q: ReceiveMessage (long poll 20s, up to 10, visibility 60s)
  C->>DB: BEGIN, INSERT job_executions(job_id) ON CONFLICT DO NOTHING
  alt claimed (first time)
    C->>C: deliver notification (log adapter today)
    C->>DB: state = 'complete'
  else already processed
    C->>C: skip (idempotent)
  end
  C->>DB: COMMIT
  C->>Q: DeleteMessage
  Note over Q: After 5 failed receives the message moves to the DLQ (14-day retention)
```

- **At-least-once delivery, exactly-once effect.** The outbox event ID is the job ID. `job_executions.job_id` is a primary key, so a redelivered message, or a consumer killed between commit and delete, cannot run a job twice.
- Events emitted today: `ticket.created`, `ticket.updated`, `comment.created`.
- The notification adapter only logs today. Replace it with SES or another provider and keep the job ID as the idempotency key.
- `WORKER_MODE` is `publisher`, `consumer`, or `all` (the default, handy locally). Each worker drains in-flight work on `SIGTERM`/`SIGINT`.
- In AWS both worker services exist, but their **desired count is 0** until you deploy with `-c enableWorkers=true` (stage 2).

</details>

---

## Multi-tenancy, authentication and authorization

<details>
<summary>Sessions, CSRF, tenant scoping and the role matrix</summary>

**Sessions.** `POST /v1/auth/login` verifies a scrypt hash (`salt:hex`, constant-time compare), creates a 32-byte random session token, and stores **only its SHA-256 hash** in `sessions` (7-day expiry). Two cookies are set, both `HttpOnly`, `SameSite=Lax`, `Secure` in production, with an optional `COOKIE_DOMAIN`:

| Cookie | Purpose |
|---|---|
| `supportdesk_session` | bearer session token |
| `supportdesk_csrf` | double-submit CSRF token |

**CSRF.** Because the CSRF cookie is `HttpOnly`, the API also returns the token in the body of `login` and `GET /v1/auth/me`. The web client keeps it in memory and echoes it in `x-csrf-token` on every request other than `GET` and `HEAD`. The API rejects any method other than `GET`, `HEAD` and `OPTIONS` (except login) whose header differs from the cookie. `/auth/me` reissues the CSRF cookie if it is missing.

**Organization selection.** Every scoped route needs `x-organization-id`. `authenticate()` joins `sessions` with `memberships` for that organization in a single query. A valid session paired with an organization the user does not belong to gets `403`.

**CORS.** Only `WEB_ORIGIN` (with credentials), and only the methods and headers above.

**Role matrix:**

| Capability | requester | agent | admin |
|---|:-:|:-:|:-:|
| Create tickets, reply publicly, upload attachments and images | ✅ (own tickets) | ✅ | ✅ |
| See tickets | own only | all in org | all in org |
| See internal notes, their images and attachments, and activity | ❌ | ✅ | ✅ |
| Write internal notes | ❌ | ✅ | ✅ |
| Update status, priority, assignee; list members | ❌ | ✅ | ✅ |
| Read knowledge base | ✅ | ✅ | ✅ |
| Create or edit articles, upload knowledge images | ❌ | ❌ | ✅ |
| Read announcements and see their banners | ✅ | ✅ | ✅ |
| Post, edit or delete announcements | ❌ | ❌ | ✅ |
| See the inbox notice (cannot dismiss it) | ✅ | ✅ | ✅ |
| Set, change or clear the inbox notice | ❌ | ❌ | ✅ |

Requesters get `404` (not `403`) for tickets they do not own, so the API does not reveal that a ticket exists. Assignees must be agents or admins in the same organization.

**Hardening:** Helmet headers, a global rate limit (`RATE_LIMIT_MAX`, default 300 per minute), a 200-character search cap, a page size of at most 100, UUID validation on every ID, length limits through Zod, and non-root containers (`USER node`).

</details>

---

## Data model

<details>
<summary>ER diagram, migrations and indexes</summary>

Migrations live in `packages/database/migrations` and run in filename order. Each runs in its own transaction and is recorded in `schema_migrations`.

```mermaid
erDiagram
  organizations ||--o{ memberships : has
  users ||--o{ memberships : has
  users ||--o{ sessions : owns
  organizations ||--o{ tickets : scopes
  memberships ||--o{ tickets : "requester / assignee"
  tickets ||--o{ comments : has
  tickets ||--o{ attachments : has
  comments |o--o{ attachments : "optional parent"
  tickets |o--o{ ticket_images : "linked on save"
  comments |o--o{ ticket_images : "linked on save"
  organizations ||--o{ knowledge_articles : scopes
  organizations ||--o{ knowledge_images : scopes
  organizations ||--o{ announcements : scopes
  organizations ||--o| organization_notices : pins
  organizations ||--o{ audit_events : scopes
  organizations ||--o{ outbox_events : scopes

  organizations {
    uuid id PK
    text name
  }
  users {
    uuid id PK
    text identity_ref UK
    text email UK
    text display_name
    text password_hash
  }
  memberships {
    uuid organization_id PK
    uuid user_id PK
    membership_role role
  }
  sessions {
    uuid id PK
    uuid user_id FK
    text token_hash UK
    timestamptz expires_at
  }
  tickets {
    uuid id PK
    uuid organization_id
    uuid requester_id
    uuid assignee_id
    text title
    text description
    text description_format
    ticket_status status
    ticket_priority priority
    int version
  }
  comments {
    uuid id PK
    uuid organization_id
    uuid ticket_id
    uuid author_id
    comment_visibility visibility
    text body
    text body_format
  }
  attachments {
    uuid id PK
    uuid organization_id
    uuid ticket_id
    uuid comment_id
    text object_key UK
    bigint size_bytes
    upload_state state
  }
  ticket_images {
    uuid id PK
    uuid organization_id
    uuid ticket_id
    uuid comment_id
    uuid uploader_id
    text object_key UK
    upload_state state
  }
  knowledge_articles {
    uuid id PK
    uuid organization_id
    text title
    text body
    uuid author_id
    uuid updated_by
    int version
  }
  knowledge_images {
    uuid id PK
    uuid organization_id
    uuid uploader_id
    text object_key UK
    upload_state state
  }
  announcements {
    uuid id PK
    uuid organization_id
    text kind
    text title
    text body
    timestamptz ends_at
    uuid author_id
    int version
  }
  organization_notices {
    uuid organization_id PK
    text kind
    text message
    uuid updated_by
    int version
  }
  audit_events {
    uuid id PK
    uuid organization_id
    uuid actor_id
    text action
    text entity_type
    uuid entity_id
    jsonb data
  }
  outbox_events {
    uuid id PK
    uuid organization_id
    text event_type
    uuid aggregate_id
    jsonb payload
    int attempts
    timestamptz available_at
    timestamptz published_at
  }
  job_executions {
    uuid job_id PK
    text event_type
    text state
    timestamptz completed_at
  }
```

| Migration | Adds |
|---|---|
| `001_initial.sql` | enums, organizations, users, memberships, sessions, tickets, comments, attachments, audit_events, outbox_events, job_executions |
| `002_knowledge.sql` | knowledge_articles, knowledge_images |
| `003_ticket_rich_text.sql` | `tickets.description_format`, ticket_images |
| `004_comment_rich_text.sql` | `comments.body_format`, `ticket_images.comment_id` |
| `005_announcements.sql` | announcements (`kind` is `news`, `maintenance` or `incident`) |
| `006_organization_notices.sql` | organization_notices, keyed by organization so there is at most one (`kind` is `released`, `maintenance` or `incident`) |

Key indexes:

- `tickets (organization_id, status, created_at DESC, id DESC)` and `(organization_id, assignee_id, …)` for inbox pagination.
- GIN `to_tsvector('english', title || ' ' || description)` for ticket search, and the same over title and body for articles.
- `comments (organization_id, ticket_id, created_at, id)`, `audit_events (organization_id, entity_type, entity_id, created_at DESC)`.
- Partial index `outbox_events (available_at, created_at) WHERE published_at IS NULL` keeps publisher polling cheap.

</details>

---

## API reference

<details>
<summary>Every endpoint with auth, role and payload</summary>

Base path `/v1` (behind `/api` on Amplify). 🔒 means a session plus `x-organization-id` are required. Mutations also need `x-csrf-token`.

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/health/live` | – | – | Liveness (container health check) |
| GET | `/health/ready` | – | – | Readiness: `SELECT 1` against the DB; `503` when unavailable (ALB target health) |
| POST | `/v1/auth/login` | – | – | `{email, password}` → user, memberships, csrfToken; sets cookies |
| POST | `/v1/auth/logout` | cookie | – | Deletes the session and clears cookies (`204`) |
| GET | `/v1/auth/me` | cookie | – | Restores the session: user, memberships, csrfToken |
| GET | `/v1/members` | 🔒 | agent+ | Organization members and roles |
| GET | `/v1/tickets` | 🔒 | any | `?status&priority&assigneeId&search&limit(≤100)&cursor` → `{items, nextCursor}` |
| GET | `/v1/tickets/summary` | 🔒 | any | `{total, byStatus}` for the inbox header, ignoring filters and pagination; requesters count only their own tickets |
| POST | `/v1/tickets` | 🔒 | any | `{title, description, priority, descriptionFormat}` |
| GET | `/v1/tickets/:id` | 🔒 | any | Ticket plus visible comments, attachments, and activity (agents) |
| PATCH | `/v1/tickets/:id` | 🔒 | agent+ | `{version, status?, priority?, assigneeId?}` → `409` on a stale version |
| POST | `/v1/tickets/:id/comments` | 🔒 | any (internal: agent+) | `{body, visibility, bodyFormat}` |
| POST | `/v1/tickets/:id/attachments` | 🔒 | any | Allocate an attachment, returns a presigned POST |
| POST | `/v1/attachments/:id/complete` | 🔒 | any | Verify the upload, mark it available |
| GET | `/v1/attachments/:id/download` | 🔒 | any | 5-minute presigned download URL |
| POST | `/v1/ticket-images` | 🔒 | any | Allocate an editor image |
| POST | `/v1/ticket-images/:id/complete` | 🔒 | uploader | Verify the upload |
| GET | `/v1/ticket-images/:id` | cookie | see rules above | `302` to a presigned URL |
| GET | `/v1/knowledge/articles` | 🔒 | any | `?search&limit&cursor`, 300-character excerpts |
| GET | `/v1/knowledge/articles/:id` | 🔒 | any | Full article |
| POST | `/v1/knowledge/articles` | 🔒 | admin | `{title, body}` |
| PATCH | `/v1/knowledge/articles/:id` | 🔒 | admin | `{version, title, body}` → `409` on a stale version |
| POST | `/v1/knowledge/images` | 🔒 | admin | Allocate a knowledge image |
| POST | `/v1/knowledge/images/:id/complete` | 🔒 | admin | Verify the upload |
| GET | `/v1/knowledge/images/:id` | cookie | member | `302` to a presigned URL |
| GET | `/v1/announcements` | 🔒 | any | `?kind&active&limit&cursor`, newest first; `active=true` drops those whose `ends_at` has passed |
| POST | `/v1/announcements` | 🔒 | admin | `{kind, title, body, endsAt?}` (`endsAt` is an ISO timestamp with an offset, or `null`) |
| PATCH | `/v1/announcements/:id` | 🔒 | admin | `{version, kind, title, body, endsAt}` → `409` on a stale version |
| DELETE | `/v1/announcements/:id` | 🔒 | admin | `204` |
| GET | `/v1/notice` | 🔒 | any | `{notice}`, or `{notice: null}` when none is set |
| PUT | `/v1/notice` | 🔒 | admin | `{kind, message, version?}`. Without `version` it only creates; with one it only updates that version. Otherwise `409` |
| DELETE | `/v1/notice` | 🔒 | admin | Clear the notice, `204` (`404` if none) |

Request schemas are defined once in [`packages/contracts/src/index.ts`](packages/contracts/src/index.ts).

</details>

---

## Local development

**Requirements:** Node 24+, pnpm 10+ (`corepack enable`), Docker.

```bash
cp .env.example .env
pnpm install
docker compose up -d     # PostgreSQL 17 on :55432, LocalStack S3 on :4566
pnpm db:migrate
pnpm db:seed
pnpm dev                 # API on :4000 (tsx watch) + web on :3000 (next dev)
```

Open <http://localhost:3000>. Every seeded account uses the password `supportdesk-demo`:

| Email | Organization | Role |
|---|---|---|
| `admin@acme.test` | Acme | admin |
| `agent@acme.test` | Acme | agent |
| `requester@acme.test` | Acme | requester |
| `admin@globex.test` | Globex | admin (use it to check tenant isolation) |

The LocalStack init script (`docker/localstack/10-s3.sh`) creates the `supportdesk-local` bucket with CORS for `http://localhost:3000`.

To run the worker locally, start a queue (for example `awslocal sqs create-queue` with `SERVICES: s3,sqs`), set `SQS_QUEUE_URL`, and run `pnpm --filter @supportdesk/worker dev`. With `SQS_QUEUE_URL` empty the worker idles.

### Root scripts

<details>
<summary>What each root pnpm script does</summary>

| Script | Does |
|---|---|
| `pnpm dev` | API + web in parallel, loading `.env` |
| `pnpm build` | Builds every package that has a `build` script |
| `pnpm test` | Unit tests in every package |
| `pnpm test:integration` | DB-backed API integration tests (needs the compose stack, migrations and seed) |
| `pnpm typecheck` | `tsc --noEmit` everywhere |
| `pnpm db:migrate` / `pnpm db:seed` | Apply migrations / upsert demo tenants and users |
| `pnpm infra <cmd>` | Runs a script in `infra` (`synth`, `diff`, `deploy`, `destroy`) |

</details>

---

## Configuration

<details>
<summary>Every environment variable</summary>

| Variable | Used by | Default / example | Notes |
|---|---|---|---|
| `NODE_ENV` | all | `development` | `production` enables `Secure` cookies and requires `SEED_PASSWORD` |
| `DATABASE_URL` | api, worker, db scripts | `postgres://supportdesk:supportdesk@localhost:55432/supportdesk` | Local. In AWS use the `DB_*` variables instead |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL` | api, worker, tasks | injected by ECS | User and password come from Secrets Manager. `DB_SSL=true` verifies the certificate |
| `DB_POOL_MAX` | api, worker | `10` | pg pool size per process |
| `API_PORT` | api | `4000` | |
| `WEB_ORIGIN` | api | `http://localhost:3000` | The only allowed CORS origin |
| `NEXT_PUBLIC_API_URL` | web (build time) | `http://localhost:4000` | `/api` for the Amplify deploy |
| `STATIC_EXPORT` | web (build time) | unset | `true` → `output: "export"`; otherwise `standalone` |
| `SESSION_COOKIE_NAME` | api | `supportdesk_session` | |
| `COOKIE_DOMAIN` | api | empty | Set only for a cross-subdomain deployment |
| `RATE_LIMIT_MAX` | api | `300` | Requests per minute per client |
| `AWS_REGION` | api, worker | `us-east-1` | |
| `ATTACHMENTS_BUCKET` | api | `supportdesk-local` | |
| `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE` | api | `http://localhost:4566`, `true` | LocalStack only |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | api | `test` | LocalStack only. Fargate uses its task role |
| `SQS_QUEUE_URL` | worker | empty | Empty means the worker idles |
| `WORKER_MODE` | worker | `all` | `publisher` \| `consumer` \| `all` |
| `SEED_PASSWORD` | seed | `supportdesk-demo` outside production | Required in production. The maintenance task reads it from Secrets Manager |

</details>

---

## Testing

<details>
<summary>Test suites and how to run them</summary>

| Suite | Location | Runner | Covers |
|---|---|---|---|
| Security | `apps/api/test/security.test.ts` | Vitest | Deterministic token hashing, malformed or incorrect password encodings |
| Auth contract | `apps/api/test/auth.test.ts` | Vitest | CSRF token in the login and `/me` bodies, HttpOnly CSRF cookie, cookie reissue |
| Markdown guard | `apps/api/test/markdown.test.ts` | Vitest | `ticketImageIds` allow-list and de-duplication |
| Knowledge permissions | `apps/api/test/knowledge.test.ts` | Vitest | Admin-only writes with audit, raster-only images, a session required for images |
| Ticket summary | `apps/api/test/ticket-summary.test.ts` | Vitest | Every status totalled including empty ones, requesters scoped to their own tickets |
| Announcement permissions | `apps/api/test/announcements.test.ts` | Vitest | Admin-only post, edit and delete with audit, kind and end-time validation, the active filter |
| Notice permissions | `apps/api/test/notice.test.ts` | Vitest | Admin-only set and clear with audit, CSRF required on `PUT`, `409` on a stale version, notice-only kinds |
| **Integration** | `apps/api/test/integration.test.ts` | Vitest + real PostgreSQL (`RUN_INTEGRATION_TESTS=true`) | Tenant isolation, requesters cannot write internal notes, a foreign-organization session is rejected, ticket-image linking and visibility, internal-note images hidden from requesters, announcements are admin-only, leave the banners once ended, a single admin-only notice per organization with stale-version and cross-organization checks (restoring any notice set locally), ticket summary counts, stay inside the organization and reject stale edits, cursor pagination returns every ticket exactly once |
| Web headers | `apps/web/test/request-headers.test.mjs` | `node:test` | Bodyless POSTs send `{}`, content type, caller headers preserved |
| Web announcements | `apps/web/test/announcement-kinds.test.mjs` | `node:test` | Banner order (incident, maintenance, news), ended and dismissed banners hidden, edits re-shown, end-time round-trip |
| Web ticket summary | `apps/web/test/ticket-summary.test.mjs` | `node:test` | Inbox header wording: status breakdown order, empty statuses skipped, singular and "your" |
| Web rich content | `apps/web/test/rich-content.test.mjs` | `node:test` | Image reference round-trips, Markdown detection, excerpts, uploaded-image detection |
| Load | `load-tests/baseline.js` | k6 | Constant-arrival-rate ticket listing with thresholds: error rate < 0.5 %, read p95 < 300 ms, rate-limited < 1 % |

```bash
pnpm test && pnpm typecheck && pnpm build
pnpm test:integration
k6 run -e API_URL=http://localhost:4000 -e RATE=7 -e DURATION=5m load-tests/baseline.js
```

Never point synthetic load at a shared or production environment without approval.

</details>

---

## CI/CD

Two workflows in `.github/workflows`:

| Workflow | Trigger | Jobs |
|---|---|---|
| `verify.yml` | every pull request, pushes to any branch except `main`, and `workflow_call` | install (frozen lockfile) → `pnpm test` → `pnpm typecheck` → `pnpm build` |
| `deploy.yml` | push to `main`, `workflow_dispatch` | `verify` → `preflight` → `api` → `web` → `smoke` |

### Pipeline

<details>
<summary>Pipeline diagram</summary>

```mermaid
flowchart LR
  pr["Pull request /<br/>feature branch push"] --> v1["verify.yml<br/>test · typecheck · build"]

  push["Push / merge to main"] --> v2["verify<br/>(reuses verify.yml)"]
  v2 --> pre{"preflight<br/>stack healthy AND<br/>Amplify app exists?"}
  pre -- "no (demo expired)" --> skip(["::notice:: skip<br/>run ends green"])
  pre -- yes --> api
  subgraph api["api · ubuntu-24.04-arm"]
    direction TB
    a1["Read CloudFormation outputs"] --> a2["docker build + push<br/>ECR :git-sha"]
    a2 --> a3["Register migrate task def<br/>with new image → ecs run-task<br/>wait · exit code must be 0"]
    a3 --> a4["cdk deploy SupportDesk<br/>-c imageTag=git-sha -c webOrigin"]
  end
  api --> web
  subgraph web["web · ubuntu-latest"]
    direction TB
    w1["next build<br/>STATIC_EXPORT=true<br/>NEXT_PUBLIC_API_URL=/api"] --> w2["zip out/"]
    w2 --> w3["amplify create-deployment<br/>upload zip · start-deployment<br/>poll job ≤ 10 min"]
  end
  web --> smoke["smoke<br/>GET WEB_ORIGIN/<br/>GET WEB_ORIGIN/api/health/ready"]
```

</details>

### Deploy sequence in detail

<details>
<summary>What each deploy job does</summary>

```mermaid
sequenceDiagram
  autonumber
  participant GH as GitHub Actions
  participant STS as AWS STS (OIDC)
  participant CF as CloudFormation
  participant ECR
  participant ECS
  participant RDS
  participant AMP as Amplify

  GH->>STS: AssumeRoleWithWebIdentity (sub = repo:Owner@id/repo@id:ref:refs/heads/main)
  STS-->>GH: 1-hour credentials for DeployRole
  GH->>CF: DescribeStacks SupportDesk (status + outputs)
  GH->>ECR: push api image tagged with GITHUB_SHA (native ARM64 build)
  GH->>ECS: RegisterTaskDefinition (MigrateTask family, new image)
  GH->>ECS: RunTask (Fargate, public subnet, API SG)
  ECS->>RDS: tsx migrate.ts (each pending migration in its own transaction)
  ECS-->>GH: task stopped, exitCode
  alt exitCode != 0
    GH-->>GH: fail run, service untouched
  else
    GH->>CF: cdk deploy (assumes the CDK bootstrap roles) with imageTag=sha
    CF->>ECS: rolling update of the API service (circuit breaker with rollback)
    ECS-->>CF: ALB /health/ready healthy
  end
  GH->>AMP: CreateDeployment → upload zip → StartDeployment → GetJob until SUCCEED
  GH->>AMP: smoke: / and /api/health/ready through the public origin
```

**Pipeline guarantees:**

- **Serialized and never cancelled.** `concurrency: deploy-learning`, `cancel-in-progress: false`. Deploys run in merge order and never stop halfway through a migration or a stack update.
- **Immutable images.** Every image is tagged with the commit SHA. `latest` is only a CDK fallback.
- **Migrate before roll out.** A failed migration stops the run before the service changes. On the very first run, before `MigrateTaskFamily` exists, this step is skipped.
- **Automatic rollback.** The ECS deployment circuit breaker reverts tasks that fail health checks.
- **Self-aware of demo expiry.** Once the scheduled expiry deletes the stack or the Amplify app, `preflight` skips the deploy instead of recreating paid resources.
- **Least privilege.** Every job has `contents: read`. Only AWS-facing jobs request `id-token: write`.

</details>

### Authentication: GitHub OIDC → AWS

<details>
<summary>How CI gets short-lived AWS credentials</summary>

`SupportDeskGitHubDeploy` (a separate stack, so the demo expiry never deletes it) creates:

- An IAM OIDC provider for `token.actions.githubusercontent.com` (audience `sts.amazonaws.com`).
- `DeployRole`, trusted **only** for `sub = <immutable subject prefix>:ref:refs/heads/main`, with a maximum session of 1 hour. The repository uses GitHub's **immutable subject** format `repo:<owner>@<ownerId>/<repo>@<repoId>`, so renaming or transferring the repo cannot hijack the trust. If the repo moves, read the new prefix with `gh api repos/<owner>/<repo>/actions/oidc/customization/sub` and redeploy with `-c githubSubjectPrefix=…`.
- Scoped permissions: assume the CDK bootstrap roles (`cdk-hnb659fds-*`), describe the `SupportDesk` stack, push to `supportdesk-*` ECR repositories, register task definitions, run **only** `SupportDeskMigrateTask*`, pass **only** the migrate task roles to `ecs-tasks.amazonaws.com`, and run Amplify deployments for the one app.

</details>

### Repository settings

<details>
<summary>Required GitHub variables and secrets</summary>

| Kind | Name | Value |
|---|---|---|
| Secret | `AWS_DEPLOY_ROLE_ARN` | `DeployRoleArn` output of `SupportDeskGitHubDeploy` |
| Variable | `AWS_REGION` | `us-east-1` (default) |
| Variable | `AMPLIFY_APP_ID` | Amplify app ID |
| Variable | `AMPLIFY_BRANCH` | optional, default `main` |
| Variable | `WEB_ORIGIN` | e.g. `https://main.<appId>.amplifyapp.com` |

No AWS access keys are stored in GitHub.

</details>

---

## Infrastructure (AWS CDK)

<details>
<summary>Stacks, resources and context flags</summary>

`infra/bin/app.ts` defines three stacks:

| Stack | Purpose | Created when |
|---|---|---|
| `SupportDesk` | The whole application: VPC, RDS, S3, SQS, ECR, ECS cluster and services, ALB, API Gateway, alarms | always |
| `SupportDeskGitHubDeploy` | OIDC provider and deploy role | always |
| `SupportDeskDemoExpiry` | EventBridge Scheduler one-shot schedules that delete the Amplify app at `demoExpiresAt` and the `SupportDesk` stack 5 minutes later | when `demoExpiresAt` or `amplifyAppId` is passed |

**Context flags** (`-c key=value`):

| Key | Default | Effect |
|---|---|---|
| `stage` | `learning` | `production` switches on the production profile (see the table above) |
| `imageTag` | `latest` | API and migrate image tag (CI passes the commit SHA) |
| `workerImageTag` | `imageTag` | Worker image tag |
| `webOrigin` | `http://localhost:3000` / `https://app.example.com` | S3 CORS origin and API `WEB_ORIGIN` |
| `certificateArn` | – | Internet-facing HTTPS ALB instead of API Gateway + VPC Link |
| `minApiTasks` / `maxApiTasks` | `1` (cdk.json) / stage default | API autoscaling bounds |
| `enableWorkers` | `false` | Sets the outbox publisher and job consumer desired count to 1 |
| `amplifyAppId` | – | Scopes Amplify permissions and expiry |
| `demoExpiresAt` | – | ISO timestamp for the self-deletion schedule |
| `githubSubjectPrefix`, `deployBranch` | this repo, `main` | OIDC trust |

**Stack outputs** used by CI and operators: `ApiUrl`, `RepositoryUri`, `WorkerRepositoryUri`, `AttachmentsBucket`, `JobsQueueUrl`, `DeadLetterQueueUrl`, `DatabaseEndpoint`, `ClusterName`, `MigrateTaskFamily`, `TaskSubnetIds`, `TaskSecurityGroupId`, and on learning `MaintenanceTaskArn` and `DemoPasswordSecretArn`.

**ECS task definitions** (all Linux/ARM64 Fargate):

| Task | CPU / Mem | Command | Log stream |
|---|---|---|---|
| ApiTask | 512 / 1024 | `node apps/api/dist/server.js`, health check `wget /health/live` | `api` |
| MigrateTask | 256 / 512 | `tsx packages/database/src/migrate.ts` | `migrate` |
| MaintenanceTask (learning) | 256 / 512 | `tsx packages/database/src/seed.ts` with `SEED_PASSWORD` from Secrets Manager | `maintenance` |
| OutboxPublisherTask | 256 / 512 | worker, `WORKER_MODE=publisher` | `publisher` |
| JobConsumerTask | 256 / 512 | worker, `WORKER_MODE=consumer` | `consumer` |

</details>

### One-time bootstrap

<details>
<summary>Bootstrap commands</summary>

An AWS admin runs this once from a workstation:

```bash
pnpm --filter @supportdesk/infra exec cdk bootstrap
pnpm --filter @supportdesk/infra exec cdk deploy SupportDeskGitHubDeploy SupportDeskDemoExpiry SupportDesk \
  -c imageTag=<currently deployed tag> -c webOrigin=<amplify origin> \
  -c amplifyAppId=<amplify app id> -c demoExpiresAt=<ISO time> --region us-east-1
```

Then set the repository secret and variables listed above, and configure the Amplify `/api/<*>` rewrite to the `ApiUrl` output.

Images must be `linux/arm64`. CI builds them on a native ARM runner.

</details>

---

## Release, rollback and migrations

<details>
<summary>Release and rollback per component</summary>

**Migrations must be backward compatible (expand, then contract).** In CI the migration runs *before* the new API image rolls out, and the old frontend keeps serving until the `web` job finishes, so for a while old code runs against the new schema. Add columns with defaults and new tables first. Remove things only in a later release.

| Component | Release | Roll back |
|---|---|---|
| API | Push a SHA-tagged image, run the migrate task, `cdk deploy -c imageTag=<sha>`, wait for ALB health | Revert the commit on `main` (CI redeploys), or `cdk deploy SupportDesk -c imageTag=<previous sha>`. Never reverse a destructive migration during an incident |
| Web | Amplify manual deployment from CI | Amplify deployment history, or revert on `main` |
| Worker | Deploy with `enableWorkers=true` and `workerImageTag` | Pause consumers before incompatible job changes. Outbox replay is safe because job IDs are stable |

`workflow_dispatch` is only trusted on `main` (the OIDC role rejects other refs).

</details>

---

## Observability and operations

<details>
<summary>Logs, health checks, alarms, backups and failure exercises</summary>

- **Logs:** Fastify JSON logs with request IDs go to CloudWatch (`ApiLogs`, one-month retention, non-blocking driver). Workers log structured JSON to their own groups (one week).
- **Health:** `/health/live` for the container health check, `/health/ready` (DB ping) for the ALB target group and the CI smoke test.
- **Alarms:** ALB target 5xx ≥ 5 in 5 minutes. The operations guide lists the alarms to add before real traffic: budget, latency, ECS CPU and memory, RDS storage and connections, SQS age and DLQ depth.
- **Backups:** 7-day RDS automated backups. See the restore rehearsal procedure in [`docs/operations.md`](docs/operations.md#backup-restore-rehearsal).
- **Failure exercises:** kill the API task, pause the publisher and drain the backlog, kill a consumer between commit and delete, deploy a failing readiness image. Results go in `docs/benchmarks/YYYY-MM-DD-<exercise>.md`.
- **Demo seeding in AWS:** run the `MaintenanceTask` as a one-off ECS task. It upserts the demo users with the generated `DemoPassword` secret.

</details>

---

## Capacity model and scaling roadmap

<details>
<summary>Traffic model and the stage-by-stage roadmap</summary>

Assumptions: 60 API requests per daily active user, a peak of 10× the daily average, 80 % reads. File bytes go directly to S3 and are excluded.

**Peak RPS = DAU × 60 ÷ 86,400 × 10**

| Stage | DAU | Requests/day | Peak RPS | Architecture move (from the plan) |
|---|---:|---:|---:|---|
| 1 | 100 | 6,000 | 0.7 | One API task, ALB, single RDS, S3. **This is the current learning deployment** |
| 2 | 1,000 | 60,000 | 7 | Turn on the outbox publisher and SQS consumer (`enableWorkers=true`) |
| 3 | 10,000 | 600,000 | 70 | Several API tasks with autoscaling; consider Multi-AZ RDS |
| 4 | 100,000 | 6,000,000 | 700 | Read replicas or caching, connection pooling, all driven by measurement |
| 5 | 1,000,000 | 60,000,000 | 7,000 | Validate before claiming. Sharding, Kafka and microservices are *not* assumed |

Initial service targets: read p95 < 300 ms, write p95 < 500 ms, unexpected errors < 0.5 %, queue age normally < 60 s, zero cross-tenant access. Each stage has explicit triggers and acceptance criteria in [`supportdesk-system-design-plan.md`](supportdesk-system-design-plan.md).

</details>

---

## Architecture decisions

| ADR | Decision |
|---|---|
| [0001 – Start with a modular monolith](docs/decisions/0001-modular-monolith.md) | One stateless Fastify service owns the business rules. Next.js uses the public API. PostgreSQL is authoritative, and attachment bytes bypass the API. Chosen because the modeled peak is 0.7 RPS and every core write shares one transactional boundary. |

New decisions follow the template in section 13 of the design plan (problem, evidence, options, decision, consequences, verification, rollback).

---

## Known limitations

- **No custom domain or TLS on the ALB in the learning stack.** HTTPS ends at Amplify and API Gateway. The internal ALB listens on HTTP:80 and is reachable only from the VPC Link security group.
- **Single API task** in learning (`minHealthyPercent: 0`), so a deploy or crash causes a short outage.
- **Workers are off** (desired count 0), and `deploy.yml` builds and pushes only the API image. Building the worker image is a manual step until stage 2.
- **Notifications only log.** No email provider is wired up yet.
- **Sessions are not cleaned up.** Expired rows stay until a cleanup job is added (`sessions_expiry_idx` exists for it).
- **Not handled by CDK:** the Amplify app, its `/api` rewrite, and the frontend deployment configuration are managed outside this repository.
- **The learning demo deletes itself** at `demoExpiresAt`. After that, CI deploys are skipped until someone runs the bootstrap again.
