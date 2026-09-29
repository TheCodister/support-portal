import { randomBytes, scryptSync } from "node:crypto";
import { createPool } from "./index.js";

function hashPassword(password: string) { const salt = randomBytes(16).toString("hex"); return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`; }
const pool = createPool();
const passwordHash = hashPassword("supportdesk-demo");
const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const org of [
    { name: "Acme", users: [["admin@acme.test", "Acme Admin", "admin"], ["agent@acme.test", "Acme Agent", "agent"], ["requester@acme.test", "Acme Requester", "requester"]] },
    { name: "Globex", users: [["admin@globex.test", "Globex Admin", "admin"]] }
  ] as const) {
    const existingOrg = await client.query("SELECT id FROM organizations WHERE name=$1 ORDER BY created_at LIMIT 1", [org.name]);
    const orgRow = existingOrg.rows[0] ? existingOrg : await client.query("INSERT INTO organizations(name) VALUES($1) RETURNING id", [org.name]);
    const organizationId = orgRow.rows[0].id;
    for (const [email, displayName, role] of org.users) {
      const user = await client.query("INSERT INTO users(identity_ref,email,display_name,password_hash) VALUES($1,$1,$2,$3) ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name RETURNING id", [email, displayName, passwordHash]);
      await client.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [organizationId, user.rows[0].id, role]);
    }
  }
  await client.query("COMMIT"); console.log("Seeded demo organizations and users");
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { client.release(); await pool.end(); }
