function required(env: Record<string, string | undefined>, name: string) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
export function configuration(env: Record<string, string | undefined> = process.env) {
  const environment = env.RUKIE_APP_ENV || "production";
  if (!["production", "development"].includes(environment))
    throw new Error("Invalid RUKIE_APP_ENV");
  const urls = JSON.parse(env.RUKIE_PUBLIC_URLS || '{"web":"http://localhost:8080/"}') as Record<
    string,
    string
  >;
  const web = new URL(urls.web);
  if (!["http:", "https:"].includes(web.protocol)) throw new Error("Invalid public web URL");
  return {
    database: required(env, "DATABASE_URL"),
    blobURL: required(env, "BLOB_STORAGE_URL"),
    blobToken: required(env, "BLOB_STORAGE_TOKEN"),
    messagingURL: env.RUKIE_API_URL || "",
    conversation: env.REPORT_CONVERSATION_ID || "",
    message: env.WELCOME_MESSAGE || "",
    environment,
    urls,
  };
}
export type Config = ReturnType<typeof configuration>;
