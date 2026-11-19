import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../dist");
const assets = resolve(root, "assets");

export async function frontendFile(path: string, page: "index.html" | "admin.html") {
  const file = resolve(root, "." + decodeURIComponent(path));
  if (file !== resolve(root, page) && !file.startsWith(assets + "/"))
    return new Response(null, { status: 404 });

  const asset = Bun.file(file);
  return (await asset.exists()) ? new Response(asset) : new Response(null, { status: 404 });
}
