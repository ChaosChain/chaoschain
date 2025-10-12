# Dockerfile for 0G Bridge gRPC Server
# Multi-stage build for optimal image size

# Stage 1: Build
FROM golang:1.21-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git make protobuf-dev

WORKDIR /build

# Copy go module files
COPY server/go.mod server/go.sum* ./
RUN go mod download

# Install protoc plugins
RUN go install google.golang.org/protobuf/cmd/protoc-gen-go@latest && \
    go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

# Copy proto and source
COPY zerog_bridge.proto ./
COPY server/*.go ./

# Generate proto code
RUN mkdir -p proto/v1 && \
    protoc --go_out=proto/v1 --go_opt=paths=source_relative \
           --go-grpc_out=proto/v1 --go-grpc_opt=paths=source_relative \
           zerog_bridge.proto

# Build
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o zerog-bridge main.go

# Stage 2: Runtime
FROM alpine:3.19

# Install runtime dependencies
RUN apk --no-cache add ca-certificates

WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/zerog-bridge .

# Expose gRPC ports
EXPOSE 50051 50052

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD nc -z localhost 50051 && nc -z localhost 50052 || exit 1

# Run
ENTRYPOINT ["./zerog-bridge"]

