## pluto server

This is the collection of services that allow any individual to self-host their own instance of the **pluto** server. It can be used to store, analyze, visualize, and share any data recorded by the latest **pluto** clients or other platforms. It's super easy to get started and we welcome you to try it yourself! All you need is a containerized environment and a minute to spare.

For a managed instance with better scalability, stability and support, please visit [pluto.trainy.ai](https://pluto.trainy.ai) or contact us at [founders@trainy.ai](mailto:founders@trainy.ai).

### 🚀 Getting Started

#### Prerequisites

- **Docker** with **Compose v2** (the `docker compose` command). This comes with [Docker Desktop](https://www.docker.com/products/docker-desktop/) or can be installed separately via the [Compose plugin](https://docs.docker.com/compose/install/).

#### 1. Get the repository

```bash
git clone https://github.com/Trainy-ai/pluto-server.git
cd pluto-server
```

#### 2. Edit the `.env` file

```bash
cp .env.example .env
```

#### 3. Let's go!

```bash
docker compose --env-file .env up --build -d
```

The server will be swiftly available at `http://localhost:3000`.

#### 4. Verify it works

1. Open `http://localhost:3000` and create an account
2. Go to `http://localhost:3000/api-keys` and generate an API key
3. Install the Python SDK and run the integration test:

```bash
pip install pluto-ml
TEST_LOCAL=true python3 tests/e2e/integration_test.py
```

When prompted, paste your API key. The test will log metrics, a table, and finish a run. If it completes successfully, your deployment is working.

### 📲 What's Inside?

- a custom frontend application hosted on `port 3000`
- a custom backend application hosted on `port 3001`
- a Rust server for high-performance data ingestion on `port 3003`
- a Python server for general-purpose health monitoring on `port 3004`
- an S3-compatible storage server on `port 9000`
- a ClickHouse database on `port 9000` (not exposed to host by default)
- a PostgreSQL database on `port 5432` (not exposed to host by default)

### 🔧 Troubleshooting

**Connecting the Python SDK to your self-hosted server:**

```python
pluto.init(settings={"host": "localhost"}) # or a specified host matching the CORS policy of the server set by .env
```

**502 Bad Gateway on first load:**

On a fresh start, the frontend (nginx) may start before the backend is ready. Nginx caches the failed connection and keeps returning 502 even after the backend comes up. Restart the frontend container to fix it:
```bash
docker compose --env-file .env restart frontend
```

**Rebuilding from scratch:**

If you encounter stale build issues, rebuild without cache:
```bash
docker compose --env-file .env build --no-cache
docker compose --env-file .env up -d
```


### 📦 Moving Servers

You should be aware of all your data stored on the server. That's why the contents of the databases are mapped to directories on the host by default. When you need to migrate the server to a different host, simply make sure you take the `.pluto` folder and `.env` file with you.

### 🤝 Contributing

We welcome any contributions to the project! Please feel free to submit any code, docs, feedback, or examples.

#### Local Development with Docker Compose

When developing locally with Docker Compose, simply run:

```bash
docker compose --env-file .env up --build
```

The frontend container runs Nginx which serves the static build and proxies API requests (`/trpc` and `/api`) to the backend container via Docker's internal network (`http://backend:3001`). This is configured in `web/app/nginx.conf`.
