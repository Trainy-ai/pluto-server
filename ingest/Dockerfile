ARG RUST_VERSION=1.86.0

# Builder Stage
FROM rust:${RUST_VERSION}-slim-bookworm AS builder
WORKDIR /app

# Install necessary build tools and dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    pkg-config \
    libssl-dev && \
    rm -rf /var/lib/apt/lists/*

COPY . .

RUN cargo build --release && \
    cp ./target/release/server-rs /

# Final Stage
FROM debian:bookworm-slim AS final

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    libssl3 \
    ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Add a non-root user
RUN adduser \
    --disabled-password \
    --gecos "" \
    --shell "/sbin/nologin" \
    --no-create-home \
    --uid "10001" \
    appuser

# Copy the built binary from the builder stage
COPY --from=builder /server-rs /usr/local/bin
COPY --from=builder /app/docker-setup /opt/docker-setup
RUN chown appuser /usr/local/bin/server-rs

# Set permissions and environment
USER appuser
ENV RUST_LOG="info"

# Set working directory and entry point
WORKDIR /opt/server-rs
ENTRYPOINT ["server-rs"]

# Expose application port
EXPOSE 3000
