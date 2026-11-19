export function viewerHandler(request: Request): Response {
  switch (new URL(request.url).pathname) {
    case "/health/ready":
      return new Response("ready");
    case "/": {
      const userId = request.headers.get("X-Rukie-User-Id");
      return userId
        ? Response.json({ user_id: userId })
        : Response.json({ error: "Rukie sign-in required" }, { status: 401 });
    }
    default:
      return new Response("Not found", { status: 404 });
  }
}
