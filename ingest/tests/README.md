# Ingest Service Integration Tests

## Overview

These integration tests use **testcontainers** to spin up real PostgreSQL and ClickHouse instances in Docker containers. This ensures tests run against actual database behavior rather than mocks.

## Prerequisites

- Docker must be running on your machine
- Rust toolchain installed

## Running Tests

```bash
# Run all tests
cargo test

# Run specific test
cargo test test_ingest_metrics_endpoint

# Run with output
cargo test -- --nocapture

# Run tests in release mode (faster)
cargo test --release
```

## Test Structure

- `tests/common/mod.rs` - Shared test utilities and container setup
- `tests/integration_tests.rs` - Main integration tests for ingest endpoints

## What's Tested

### Ingest Endpoints
- ✅ POST /ingest/metrics - Metrics ingestion
- ✅ POST /ingest/logs - Log ingestion
- ✅ POST /ingest/data - Generic data ingestion
- ✅ Authentication header validation

## CI Integration

Tests run automatically in Buildkite on:
- Pull requests to main
- Pushes to main branch

## Test Database Cleanup

Testcontainers automatically cleans up containers after tests complete. No manual cleanup needed.
