import { SQL } from "bun";
import { configuration } from "./config";
import { migrate } from "./db/migrate";
import { BlobStorage } from "./integrations/blobs";
import { NotesService } from "./services/notes";
import { publicHandler } from "./http/public";
import { privateHandler } from "./http/private";
const config = configuration();
const db = new SQL(config.database, {
  max: 4,
  connectionTimeout: 3,
  connection: { statement_timeout: 15000, lock_timeout: 15000 },
});
await migrate(db);
const service = new NotesService(db, new BlobStorage(config.blobURL, config.blobToken));
const version = (await Bun.file(new URL("../VERSION", import.meta.url)).text()).trim();
const web = Bun.serve({
  port: 8080,
  hostname: "0.0.0.0",
  maxRequestBodySize: 33 * 1024 * 1024,
  fetch: publicHandler(service, config, version),
});
const api = Bun.serve({
  port: 8081,
  hostname: "127.0.0.1",
  maxRequestBodySize: 128 * 1024,
  fetch: privateHandler(service),
});
console.log(`Notes ready on ${web.port}, version ${version}`);
process.on("SIGTERM", async () => {
  await web.stop();
  await api.stop();
  await db.close();
  process.exit(0);
});
