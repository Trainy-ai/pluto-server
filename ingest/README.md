# mlop ingest

This is the Rust backend server for mlop, handling data ingestion, file uploads, and interactions with ClickHouse and S3-compatible storage.

## Prerequisites

- Rust toolchain (latest stable recommended)
- Access to a PostgreSQL database
- Access to a ClickHouse instance
- Access to an S3-compatible object storage service (e.g., AWS S3, Cloudflare R2, MinIO)

## Configuration

Configuration is managed through environment variables. The server requires several variables to be set for database connections, storage credentials, and other settings.

1.  **Create Environment Files:**
    You can create environment-specific `.env` files. Common examples include:

    - `.env.dev`: For local development
    - `.env.prod`: For production deployment
    - `.env.local`: For local overrides (often gitignored)

    Copy the `.env.example` file as a template:

    ```bash
    cp .env.example .env.dev
    cp .env.example .env.prod
    ```

2.  **Populate Environment Files:**
    Edit each `.env.<environment>` file (e.g., `.env.dev`) and fill in the required values according to the comments in `.env.example`.

    **Required Variables:**

    - `RUST_LOG`: Logging level (e.g., `server_rs=info`)
    - `CLICKHOUSE_URL`: ClickHouse connection URL
    - `CLICKHOUSE_USER`: ClickHouse username
    - `CLICKHOUSE_PASSWORD`: ClickHouse password
    - `DATABASE_URL`: PostgreSQL connection URL
    - `STORAGE_ACCESS_KEY_ID`: S3-compatible storage access key ID
    - `STORAGE_SECRET_ACCESS_KEY`: S3-compatible storage secret access key
    - `STORAGE_BUCKET`: S3-compatible storage bucket name
    - `STORAGE_REGION`: AWS region/Cloudflare region identifier (e.g., `us-east-1`)
    - `STORAGE_ENDPOINT`: S3-compatible storage endpoint URL

    **Optional Variables:**

    - `SKIP_UPLOAD=true`: If set to `true`, the server will skip uploading data to ClickHouse and object storage. Useful for local testing without actual data persistence.

## Running the Server

You need to specify which environment configuration to load using the `--env` command-line flag when running the server.

**Development:**

```bash
cargo run -- --env dev
```

This command compiles and runs the server, loading environment variables from the `.env.dev` file.

**Production (Example):**

```bash
cargo run --release -- --env prod
```

This command compiles the server in release mode (optimized) and runs it, loading environment variables from `.env.prod`.

**Running without an Environment File:**

If you run `cargo run` without the `--env` flag, the server will first look for a default `.env` file. If found, it will load variables from there. If not found, it will proceed without loading any `.env` file (relying solely on system environment variables if they are set).

```bash
cargo run
```

## Building the Server

Building the server compiles the executable.

**Development Build:**

```bash
cargo build
```

**Release Build:**

```bash
cargo build --release
```

**Important:** Building the server **does not** bake the environment configuration into the binary. You still need to provide the `--env <environment>` flag when running the compiled executable directly.

**Running the built executable:**

```bash
./target/release/server-rs --env prod
```

Alternatively, you can set the environment variables directly in the shell where you run the executable, without using an `.env` file or the `--env` flag.
