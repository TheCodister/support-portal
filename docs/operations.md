# Operations guide

## Local verification

```bash
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm test
pnpm test:integration
pnpm typecheck
pnpm build
```

Run the baseline with `k6 run -e API_URL=http://localhost:4000 load-tests/baseline.js`. Stage peak rates from the plan are 1, 7, 70, 700, and 7,000 RPS; start low and never point synthetic traffic at production without approval.

## AWS deployment

1. Choose the AWS account, region, domain, monthly budget, and maximum task count. Bootstrap CDK once.
2. Run `pnpm infra synth` and inspect the template. Deploy with context values, for example `pnpm infra deploy -- --context stage=learning --context webOrigin=https://app.example.com --context certificateArn=<acm-arn> --context imageTag=<git-sha>`. Add `--context enableWorkers=true --context workerImageTag=<git-sha>` at stage 2.
3. Build both container images for `linux/arm64`, push immutable commit tags to ECR, and run `pnpm db:migrate` as a one-off task before the service rollout. Never use `latest` for a controlled release.
4. Add an ACM certificate and HTTPS listener, point `api.example.com` to the ALB, and remove or redirect the HTTP listener. The stack intentionally does not guess certificate or hosted-zone ownership.
5. Connect the repository to Amplify, use `amplify.yml`, set only `NEXT_PUBLIC_API_URL` in the web build, and keep preview branches pointed at staging.
6. Configure budget alerts, ALB 5xx and latency alarms, ECS CPU and memory alarms, RDS storage and connections alarms, and SQS age and DLQ alarms before accepting traffic.

The learning stack uses public-subnet Fargate tasks to avoid NAT cost, but their security group permits application ingress only from the ALB. RDS is isolated. Production context enables two API tasks, Multi-AZ RDS, enhanced container insights, bucket versioning, deletion protection, and retained data.

## Release and rollback

- API: publish a commit-tagged image, run a backward-compatible migration, update `imageTag`, inspect `cdk diff`, deploy, and wait for ALB health. Roll back by redeploying the previous image tag. Do not reverse a destructive migration during an incident.
- Web: Amplify deploys independently. Keep API changes additive across at least one frontend release window. Roll back from Amplify deployment history.
- Worker: pause consumers before incompatible job changes. Outbox messages and stable job IDs make replay safe.

## Backup restore rehearsal

Create a manual RDS snapshot, restore it to a new isolated instance, run the API with an isolated configuration, and verify organization, ticket, comment, audit, and attachment metadata counts. Record snapshot time, latest recovered row timestamp, restore-ready time, validation time, estimated RPO, and observed RTO. Never repoint production during a rehearsal.

## Failure exercises

- Stop the sole learning API task while polling `/health/ready`; record time until ECS replaces it and requests recover.
- Pause the outbox publisher, create tickets, resume it, and verify the backlog drains. Kill a consumer after work and before delete; verify `job_executions` prevents a second logical execution.
- Deploy an image whose readiness endpoint fails and verify ECS and ALB do not route traffic to it.
- Disable the cache only after one is introduced; ensure fallback concurrency is bounded before running load.

Store each result under `docs/benchmarks/YYYY-MM-DD-<exercise>.md` with commit, infrastructure configuration, dataset, generator location, latency percentiles, errors, rejected traffic, recovery timeline, cost, and next bottleneck.
