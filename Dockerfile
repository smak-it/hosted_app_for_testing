FROM oven/bun:1.4.2 AS frontend
WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY vite.config.js ./
COPY web ./web
RUN bun run build

FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
COPY migrations ./migrations
COPY --from=frontend /src/dist ./dist
RUN CGO_ENABLED=0 go build -trimpath -o /notes .

FROM build AS checks
CMD ["go", "test", "-v", "./..."]

FROM alpine:3.22
WORKDIR /app
COPY VERSION ./
COPY --from=build /notes /notes
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/notes"]
