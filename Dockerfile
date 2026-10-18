FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
COPY migrations ./migrations
COPY web ./web
RUN CGO_ENABLED=0 go build -trimpath -o /notes .

FROM alpine:3.22
WORKDIR /app
COPY VERSION ./
COPY --from=build /notes /notes
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/notes"]
