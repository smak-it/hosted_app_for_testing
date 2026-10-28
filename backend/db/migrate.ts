import type { SQL } from "bun";
import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";

const legacy = new Set(["001_notes.sql", "002_attachments.sql", "003_invocations.sql"]);

// Startup holds one transaction lock until all migrations commit, before serving HTTP.
export async function migrate(db: SQL, directory = new URL("./migrations/", import.meta.url)) {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  if (!names.length || names.some((name) => !/^\d{3}_[a-z0-9_]+\.sql$/.test(name)))
    throw new Error("Expected numbered SQL migrations");
  if (new Set(names.map((name) => name.slice(0, 3))).size !== names.length)
    throw new Error("Duplicate migration number");
  await db.begin(async (tx) => {
    await tx`
      SELECT pg_advisory_xact_lock(710031)
    `;
    await tx`
      CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())
    `;
    await tx`
      ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text
    `;
    const ledger: { version: number; checksum: string | null }[] = await tx`
      SELECT version, checksum
      FROM schema_migrations
      ORDER BY version
    `;
    const applied = ledger.map((row) => ({
      ...row,
      name: names.find((name) => Number(name.slice(0, 3)) === row.version) || "missing",
    }));
    if (applied.some((row) => !names.includes(row.name)))
      throw new Error("Applied migration is missing");
    for (const name of names) {
      const sql = await Bun.file(new URL(name, directory)).text();
      const checksum = createHash("sha256").update(sql).digest("hex");
      const previous = applied.find((row) => row.name === name);
      if (previous) {
        if (previous.checksum === checksum) continue;
        // The three original migrations predate checksums; their SQL is unchanged.
        if (previous.checksum || !legacy.has(name)) throw new Error(`Migration changed: ${name}`);
        await tx`
      UPDATE schema_migrations
      SET checksum = ${checksum}
      WHERE version = ${Number(name.slice(0, 3))}
    `;
      } else {
        if (applied.some((row) => row.name > name))
          throw new Error(`Out-of-order migration: ${name}`);
        await tx.unsafe(sql);
        await tx`
      INSERT INTO schema_migrations (version, checksum)
      VALUES (${Number(name.slice(0, 3))}, ${checksum})
      ON CONFLICT (version) DO UPDATE
      SET checksum = EXCLUDED.checksum
    `;
      }
    }
  });
}
