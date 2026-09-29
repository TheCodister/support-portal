import { DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { createPool, transaction } from "@supportdesk/database";

const db = createPool(); const sqs = new SQSClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const queueUrl = process.env.SQS_QUEUE_URL; const mode = process.env.WORKER_MODE ?? "all"; let stopping = false;
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
process.on("SIGTERM", () => { stopping = true; }); process.on("SIGINT", () => { stopping = true; });

async function publishBatch() {
  if (!queueUrl) return 0;
  const events = await db.query("SELECT * FROM outbox_events WHERE published_at IS NULL AND available_at<=now() ORDER BY created_at LIMIT 20");
  for (const event of events.rows) {
    try {
      await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify({ id: event.id, type: event.event_type, organizationId: event.organization_id, aggregateId: event.aggregate_id, payload: event.payload }) }));
      await db.query("UPDATE outbox_events SET published_at=now(),attempts=attempts+1,last_error=NULL WHERE id=$1 AND published_at IS NULL", [event.id]);
    } catch (error) {
      await db.query("UPDATE outbox_events SET attempts=attempts+1,last_error=$2,available_at=now()+(least(attempts+1,10)*interval '10 seconds') WHERE id=$1", [event.id, error instanceof Error ? error.message.slice(0, 500) : "Unknown publish error"]);
    }
  }
  return events.rowCount ?? 0;
}

async function consumeOnce() {
  if (!queueUrl) return 0;
  const response = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20, VisibilityTimeout: 60 }));
  for (const message of response.Messages ?? []) {
    try {
      const event = JSON.parse(message.Body ?? "{}");
      await transaction(db, async (client) => {
        const claimed = await client.query("INSERT INTO job_executions(job_id,event_type,state) VALUES($1,$2,'processing') ON CONFLICT(job_id) DO NOTHING RETURNING job_id", [event.id, event.type]);
        if (claimed.rowCount) {
          // Replace this log-only notification adapter with SES/another provider. The stable job ID remains the idempotency key.
          console.log(JSON.stringify({ level: "info", message: "notification delivered", eventId: event.id, eventType: event.type, organizationId: event.organizationId }));
          await client.query("UPDATE job_executions SET state='complete',completed_at=now() WHERE job_id=$1", [event.id]);
        }
      });
      await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
    } catch (error) { console.error(JSON.stringify({ level: "error", message: "job failed", error: error instanceof Error ? error.message : String(error) })); }
  }
  return response.Messages?.length ?? 0;
}

console.log(JSON.stringify({ level: "info", message: "worker started", mode }));
while (!stopping) {
  let work = 0;
  if (mode === "publisher" || mode === "all") work += await publishBatch();
  if (mode === "consumer" || mode === "all") work += await consumeOnce();
  if (!work) await delay(queueUrl ? 1_000 : 5_000);
}
await db.end();
