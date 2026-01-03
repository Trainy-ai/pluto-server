use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::path::PathBuf;
use std::sync::Arc;
use testcontainers::{
    runners::AsyncRunner,
    ContainerAsync,
};
use testcontainers_modules::{
    postgres::Postgres,
    clickhouse::ClickHouse,
};
use tokio::sync::mpsc;

use server_rs::dlq::DlqConfig;
use server_rs::models::{data::DataRow, files::FilesRow, log::LogRow, metrics::MetricRow};

// Test database helper
pub async fn setup_test_database(database_url: &str) -> PgPool {
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await
        .expect("Failed to connect to test database");

    // Run minimal schema setup for tests
    // Enable pgcrypto extension for gen_random_uuid()
    sqlx::query(r#"CREATE EXTENSION IF NOT EXISTS "pgcrypto""#)
        .execute(&pool)
        .await
        .expect("Failed to enable pgcrypto extension");

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS "api_key" (
            id TEXT PRIMARY KEY,
            "organizationId" TEXT NOT NULL,
            "key" TEXT NOT NULL,
            "expiresAt" TIMESTAMPTZ,
            "lastUsed" TIMESTAMPTZ,
            "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        "#,
    )
    .execute(&pool)
    .await
    .expect("Failed to create api_key table");

    pool
}

// Create a test API key in the database
pub async fn create_test_api_key(pool: &PgPool, api_key: &str, tenant_id: &str) {
    use sha2::{Sha256, Digest};

    // Hash the API key
    let mut hasher = Sha256::new();
    hasher.update(api_key.as_bytes());
    let hashed_key = format!("{:x}", hasher.finalize());

    // Insert the API key with matching schema
    sqlx::query(
        r#"
        INSERT INTO "api_key" (id, "organizationId", "key", "createdAt")
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        "#,
    )
    .bind("test-api-key-id")
    .bind(tenant_id)
    .bind(hashed_key)
    .execute(pool)
    .await
    .expect("Failed to insert test API key");
}

// ClickHouse test helper
pub async fn setup_clickhouse_tables(clickhouse_url: &str, user: &str, password: &str) {
    let client = clickhouse::Client::default()
        .with_url(clickhouse_url)
        .with_user(user)
        .with_password(password);

    // Create metrics table
    let metrics_sql = include_str!("../../docker-setup/sql/metrics.sql");
    client
        .query(metrics_sql)
        .execute()
        .await
        .expect("Failed to create metrics table");

    // Create console/logs table
    let console_sql = include_str!("../../docker-setup/sql/console.sql");
    client
        .query(console_sql)
        .execute()
        .await
        .expect("Failed to create console table");

    // Create data table
    let data_sql = include_str!("../../docker-setup/sql/data.sql");
    client
        .query(data_sql)
        .execute()
        .await
        .expect("Failed to create data table");

    // Create files table
    let files_sql = include_str!("../../docker-setup/sql/files.sql");
    client
        .query(files_sql)
        .execute()
        .await
        .expect("Failed to create files table");
}

// Test containers setup
pub struct TestContainers {
    pub postgres_container: ContainerAsync<Postgres>,
    pub clickhouse_container: ContainerAsync<ClickHouse>,
    pub postgres_url: String,
    pub clickhouse_url: String,
    pub postgres_pool: PgPool,
    pub api_key: String,
    pub tenant_id: String,
}

impl TestContainers {
    pub async fn new() -> Self {
        // Allow overriding the host used to reach testcontainers when running inside Docker
        let testcontainers_host =
            std::env::var("TESTCONTAINERS_HOST_OVERRIDE").unwrap_or_else(|_| "127.0.0.1".into());

        // Start PostgreSQL container
        let postgres_container = Postgres::default()
            .start()
            .await
            .expect("Failed to start postgres container");

        let postgres_port = postgres_container.get_host_port_ipv4(5432).await.expect("Failed to get postgres port");
        let postgres_url = format!(
            "postgresql://postgres:postgres@{}:{}/postgres",
            testcontainers_host,
            postgres_port
        );

        // Start ClickHouse container
        let clickhouse_container = ClickHouse::default()
            .start()
            .await
            .expect("Failed to start clickhouse container");

        let clickhouse_port = clickhouse_container.get_host_port_ipv4(8123).await.expect("Failed to get clickhouse port");
        let clickhouse_url = format!("http://{}:{}", testcontainers_host, clickhouse_port);

        // Give ClickHouse a moment to fully start
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        // Setup database schemas
        let postgres_pool = setup_test_database(&postgres_url).await;
        setup_clickhouse_tables(&clickhouse_url, "default", "").await;

        // Create test API key
        let api_key = "test-api-key-12345".to_string();
        let tenant_id = "test-tenant".to_string();
        create_test_api_key(&postgres_pool, &api_key, &tenant_id).await;

        Self {
            postgres_container,
            clickhouse_container,
            postgres_url,
            clickhouse_url,
            postgres_pool,
            api_key,
            tenant_id,
        }
    }
}

// Create a test AppState without background processors
// Returns AppState and receivers (receivers must be kept alive to prevent channel closure)
pub fn create_test_app_state(
    db: Arc<server_rs::db::Database>,
    clickhouse_client: clickhouse::Client,
    config: Arc<server_rs::config::Config>,
) -> (
    Arc<server_rs::routes::AppState>,
    mpsc::Receiver<MetricRow>,
    mpsc::Receiver<LogRow>,
    mpsc::Receiver<DataRow>,
    mpsc::Receiver<FilesRow>,
) {
    let (metrics_sender, metrics_receiver) = mpsc::channel::<MetricRow>(100);
    let (log_sender, log_receiver) = mpsc::channel::<LogRow>(100);
    let (data_sender, data_receiver) = mpsc::channel::<DataRow>(100);
    let (files_sender, files_receiver) = mpsc::channel::<FilesRow>(100);

    // Create a disabled DLQ config for testing
    let dlq_config = Arc::new(DlqConfig {
        enabled: false,
        base_path: PathBuf::from("/tmp/dlq-test"),
        max_disk_mb: 100,
        batch_ttl_hours: 24,
        replay_on_startup: false,
        replay_interval_secs: 60,
        cleanup_interval_secs: 60,
    });

    let app_state = Arc::new(server_rs::routes::AppState {
        metrics_record_sender: metrics_sender,
        log_record_sender: log_sender,
        data_record_sender: data_sender,
        files_record_sender: files_sender,
        clickhouse_client,
        db,
        dlq_config,
        config,
    });

    (
        app_state,
        metrics_receiver,
        log_receiver,
        data_receiver,
        files_receiver,
    )
}

// Test fixture that encapsulates all test setup
pub struct TestFixture {
    #[allow(dead_code)]
    containers: TestContainers,
    app_state: Arc<server_rs::routes::AppState>,
    pub api_key: String,
    pub tenant_id: String,
    // Keep channel receivers alive so channels don't close
    #[allow(dead_code)]
    _metrics_receiver: mpsc::Receiver<MetricRow>,
    #[allow(dead_code)]
    _log_receiver: mpsc::Receiver<LogRow>,
    #[allow(dead_code)]
    _data_receiver: mpsc::Receiver<DataRow>,
    #[allow(dead_code)]
    _files_receiver: mpsc::Receiver<FilesRow>,
}

impl TestFixture {
    pub async fn new() -> Self {
        // Install rustls crypto provider (safe to call multiple times)
        let _ = rustls::crypto::CryptoProvider::install_default(
            rustls::crypto::aws_lc_rs::default_provider()
        );

        // Setup test containers (includes API key creation)
        let containers = TestContainers::new().await;

        // Setup database connection
        let db = server_rs::db::Database::connect(&containers.postgres_url)
            .await
            .expect("Failed to connect to test database");
        let db = Arc::new(db);

        // Setup ClickHouse client
        let clickhouse_client = clickhouse::Client::default()
            .with_url(&containers.clickhouse_url)
            .with_user("test")
            .with_password("test");

        // Create test config
        let config = server_rs::config::Config {
            database_url: containers.postgres_url.clone(),
            clickhouse_url: containers.clickhouse_url.clone(),
            clickhouse_user: "default".to_string(),
            clickhouse_password: "".to_string(),
            storage_access_key_id: "test".to_string(),
            storage_secret_access_key: "test".to_string(),
            storage_bucket: "test-bucket".to_string(),
            storage_region: "us-east-1".to_string(),
            storage_endpoint: "http://localhost:9000".to_string(),
        };
        let config = Arc::new(config);

        // Create test app state and get channel receivers
        let (app_state, metrics_receiver, log_receiver, data_receiver, files_receiver) =
            create_test_app_state(db, clickhouse_client, config);

        // Get API key and tenant ID from containers
        let api_key = containers.api_key.clone();
        let tenant_id = containers.tenant_id.clone();

        Self {
            containers,
            app_state,
            api_key,
            tenant_id,
            _metrics_receiver: metrics_receiver,
            _log_receiver: log_receiver,
            _data_receiver: data_receiver,
            _files_receiver: files_receiver,
        }
    }

    pub fn app_state(&self) -> Arc<server_rs::routes::AppState> {
        Arc::clone(&self.app_state)
    }

    pub fn router(&self) -> axum::Router {
        use server_rs::routes::ingest;
        axum::Router::new()
            .merge(ingest::router())
            .with_state(self.app_state())
    }
}
