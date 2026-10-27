FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run check && bun run lint && bun run build

FROM oven/bun:1.4.2-slim
WORKDIR /app
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --from=build --chown=bun:bun /app/backend ./backend
COPY --from=build --chown=bun:bun /app/shared ./shared
COPY --from=build --chown=bun:bun /app/VERSION ./VERSION
USER bun
EXPOSE 8080
CMD ["bun", "backend/main.ts"]
