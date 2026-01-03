mod auth;
mod config;
mod db;
mod dlq;
mod error;
mod models;
mod processors;
mod routes;
mod traits;
mod utils;

use axum::Router;
use clap::Parser;
use clickhouse::Client;
use tracing::info;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use config::{
    Config, DATA_FLUSH_CONFIG, FILES_FLUSH_CONFIG, LOGS_FLUSH_CONFIG, METRICS_FLUSH_CONFIG,
};
use models::{data::DataRow, files::FilesRow, log::LogRow};
use routes::step;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::mpsc;

use crate::db::Database;
use crate::models::metrics::MetricRow;
use crate::processors::background::start_background_processor;
use crate::routes::{files, health, ingest, AppState};

// Define command-line arguments
#[derive(Parser, Debug)]
#[clap(author, version, about, long_about = None)]
struct Cli {
    /// Optional: Specify environment to load (.env.<ENV> file)
    #[clap(long)]
    env: Option<String>,
}

#[tokio::main]
async fn main() {
    // Parse command-line arguments
    let cli = Cli::parse();

    // Load environment variables based on --env flag
    match &cli.env {
        Some(env_name) => {
            let filename = format!(".env.{}", env_name);
            // Check if the file exists
            if !std::path::Path::new(&filename).exists() {
                panic!("File {} does not exist", filename);
            }
            match dotenv::from_filename(&filename) {
                Ok(_) => println!("Loaded environment variables from {}", filename),
                Err(_) => panic!("Could not load {}", filename),
            }
        }
        None => {
            // Attempt to load default .env file if no specific env is provided
            // This maintains previous behavior if needed, but makes it optional
            // You could remove this block if you *only* want env vars loaded via --env
            match dotenv::dotenv() {
                Ok(_) => {
                    let color = if std::env::var("BYPASS_ENV_WARNING").unwrap_or_default() == "true"
                    {
                        "\x1b[33m" // Yellow
                    } else {
                        "\x1b[31m" // Red
                    };

                    println!("\n{}⚠️  We strongly recommend using a specific environment .env.<ENV> file, not a default .env file\x1b[0m", color);
                    println!("{}⚠️  For example: `cargo run -- --env dev`\x1b[0m", color);
                    println!(
                        "{}⚠️  Supported environments: local, dev, prod\x1b[0m\n",
                        color
                    );

                    // Check for BYPASS_ENV_WARNING env var
                    if std::env::var("BYPASS_ENV_WARNING").unwrap_or_default() != "true" {
                        println!("{}⚠️  Exiting due to environment warning\x1b[0m", color);
                        std::process::exit(1);
                    } else {
                        println!("{}⚠️  BYPASS_ENV_WARNING is set to true, skipping environment warning\x1b[0m", color);
                    }
                }
                Err(_) => println!("No .env file specified or found, proceeding without it."),
            }
        }
    }

    // Initialize tracing subscriber for logging
    tracing_subscriber::registry()
        .with(fmt::layer().without_time().with_target(false))
        .with(EnvFilter::from_default_env())
        .init();

    // Check if data upload should be skipped (useful for local testing)
    let skip_upload = std::env::var("SKIP_UPLOAD").unwrap_or_default() == "true";

    // Load application configuration
    let config = Config::new();
    // tracing::info!(database_url = %config.database_url, clickhouse_url = %config.clickhouse_url, "Configuration loaded");

    // Connect to the primary database (e.g., PostgreSQL)
    let db = Database::connect(&config.database_url)
        .await
        .expect("Failed to connect to database");

    // Wrap database connection in an Arc for shared access
    let db = Arc::new(db);

    // Create MPSC channels for different data types to be processed in the background
    let (metrics_record_sender, metrics_record_receiver) = mpsc::channel::<MetricRow>(1_000);
    let (log_record_sender, log_record_receiver) = mpsc::channel::<LogRow>(1_000);
    let (data_record_sender, data_record_receiver) = mpsc::channel::<DataRow>(1_000);
    let (files_record_sender, files_record_receiver) = mpsc::channel::<FilesRow>(1_000);

    // Configure the ClickHouse client
    let clickhouse_client = Client::default()
        .with_url(config.clickhouse_url.clone())
        .with_user(config.clickhouse_user.clone())
        .with_password(config.clickhouse_password.clone());

    // Wrap config in an Arc for shared access
    let config = Arc::new(config);

    // Initialize Dead-Letter Queue configuration
    let dlq_config = Arc::new(dlq::DlqConfig::from_env());
    info!(
        enabled = dlq_config.enabled,
        path = %dlq_config.base_path.display(),
        "DLQ configuration loaded"
    );

    // Initialize DLQ directories
    if dlq_config.enabled {
        dlq::init_directories(&dlq_config)
            .await
            .expect("Failed to initialize DLQ directories");
        info!("DLQ directories initialized");
    }

    // Replay batches from previous pod lifetime on startup (in background)
    // This runs asynchronously to avoid blocking server startup if there are many batches
    if dlq_config.enabled && dlq_config.replay_on_startup {
        let replay_config = dlq_config.clone();
        let replay_client = clickhouse_client.clone();

        tokio::spawn(async move {
            info!("Starting DLQ startup replay in background");

            // Replay metrics batches
            match dlq::replay::replay_on_startup::<MetricRow, _, _>(
                &replay_client,
                &replay_config,
                crate::config::METRICS_TABLE_NAME,
            ).await {
                Ok(stats) => info!(
                    table = crate::config::METRICS_TABLE_NAME,
                    replayed = stats.replayed,
                    failed_batches = stats.failed_batches,
                    failed_records = stats.failed_records,
                    "Metrics DLQ startup replay completed"
                ),
                Err(e) => tracing::error!(error = %e, "Metrics DLQ startup replay failed"),
            }

            // Replay logs batches
            match dlq::replay::replay_on_startup::<LogRow, _, _>(
                &replay_client,
                &replay_config,
                crate::config::LOGS_TABLE_NAME,
            ).await {
                Ok(stats) => info!(
                    table = crate::config::LOGS_TABLE_NAME,
                    replayed = stats.replayed,
                    failed_batches = stats.failed_batches,
                    failed_records = stats.failed_records,
                    "Logs DLQ startup replay completed"
                ),
                Err(e) => tracing::error!(error = %e, "Logs DLQ startup replay failed"),
            }

            // Replay data batches
            match dlq::replay::replay_on_startup::<DataRow, _, _>(
                &replay_client,
                &replay_config,
                crate::config::DATA_TABLE_NAME,
            ).await {
                Ok(stats) => info!(
                    table = crate::config::DATA_TABLE_NAME,
                    replayed = stats.replayed,
                    failed_batches = stats.failed_batches,
                    failed_records = stats.failed_records,
                    "Data DLQ startup replay completed"
                ),
                Err(e) => tracing::error!(error = %e, "Data DLQ startup replay failed"),
            }

            // Replay files batches
            match dlq::replay::replay_on_startup::<FilesRow, _, _>(
                &replay_client,
                &replay_config,
                crate::config::FILES_TABLE_NAME,
            ).await {
                Ok(stats) => info!(
                    table = crate::config::FILES_TABLE_NAME,
                    replayed = stats.replayed,
                    failed_batches = stats.failed_batches,
                    failed_records = stats.failed_records,
                    "Files DLQ startup replay completed"
                ),
                Err(e) => tracing::error!(error = %e, "Files DLQ startup replay failed"),
            }

            info!("DLQ startup replay completed for all tables");
        });

        info!("DLQ startup replay task spawned");
    }

    // Spawn background processors for each data type
    // These processors receive data through channels and upload it
    tokio::spawn(start_background_processor(
        metrics_record_receiver,
        METRICS_FLUSH_CONFIG,
        skip_upload,
        config.clone(),
        dlq_config.clone(),
    ));

    tokio::spawn(start_background_processor(
        log_record_receiver,
        LOGS_FLUSH_CONFIG,
        skip_upload,
        config.clone(),
        dlq_config.clone(),
    ));

    tokio::spawn(start_background_processor(
        data_record_receiver,
        DATA_FLUSH_CONFIG,
        skip_upload,
        config.clone(),
        dlq_config.clone(),
    ));

    tokio::spawn(start_background_processor(
        files_record_receiver,
        FILES_FLUSH_CONFIG,
        skip_upload,
        config.clone(),
        dlq_config.clone(),
    ));

    // Spawn DLQ background tasks
    if dlq_config.enabled {
        // Spawn cleanup task with panic recovery
        let cleanup_config = dlq_config.clone();
        tokio::spawn(async move {
            let mut restart_count = 0u32;
            let max_backoff_secs = 300; // 5 minutes

            loop {
                info!(restart_count = restart_count, "Starting DLQ cleanup task");

                // Spawn cleanup loop in nested task to catch panics
                let task_config = cleanup_config.clone();
                let handle = tokio::spawn(async move {
                    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(task_config.cleanup_interval_secs));
                    loop {
                        interval.tick().await;
                        if let Err(e) = dlq::cleanup::cleanup_expired_batches(&task_config).await {
                            tracing::error!(error = %e, "DLQ cleanup failed");
                        }
                        if let Err(e) = dlq::cleanup::enforce_disk_quota(&task_config).await {
                            tracing::error!(error = %e, "DLQ quota enforcement failed");
                        }
                    }
                });

                // Wait for task to complete (panic or normal exit)
                match handle.await {
                    Ok(_) => {
                        tracing::warn!("DLQ cleanup task exited normally (unexpected)");
                    }
                    Err(e) => {
                        tracing::error!(error = %e, restart_count = restart_count, "DLQ cleanup task panicked, will restart");
                    }
                }

                // Exponential backoff before restart (capped at max_backoff_secs)
                restart_count += 1;
                let backoff_secs = (2u64.pow(restart_count).min(max_backoff_secs as u64)) as u64;
                tracing::warn!(backoff_secs = backoff_secs, "Waiting before restarting DLQ cleanup task");
                tokio::time::sleep(tokio::time::Duration::from_secs(backoff_secs)).await;
            }
        });

        info!("DLQ cleanup task spawned");

        // Spawn replay tasks for continuous retry of failed batches
        // Metrics replay loop
        let metrics_client = clickhouse_client.clone();
        let metrics_config = dlq_config.clone();
        tokio::spawn(async move {
            dlq::replay::start_replay_loop::<MetricRow, _, _>(
                metrics_client,
                metrics_config,
                crate::config::METRICS_TABLE_NAME.to_string(),
            ).await;
        });

        // Logs replay loop
        let logs_client = clickhouse_client.clone();
        let logs_config = dlq_config.clone();
        tokio::spawn(async move {
            dlq::replay::start_replay_loop::<LogRow, _, _>(
                logs_client,
                logs_config,
                crate::config::LOGS_TABLE_NAME.to_string(),
            ).await;
        });

        // Data replay loop
        let data_client = clickhouse_client.clone();
        let data_config = dlq_config.clone();
        tokio::spawn(async move {
            dlq::replay::start_replay_loop::<DataRow, _, _>(
                data_client,
                data_config,
                crate::config::DATA_TABLE_NAME.to_string(),
            ).await;
        });

        // Files replay loop
        let files_client = clickhouse_client.clone();
        let files_config = dlq_config.clone();
        tokio::spawn(async move {
            dlq::replay::start_replay_loop::<FilesRow, _, _>(
                files_client,
                files_config,
                crate::config::FILES_TABLE_NAME.to_string(),
            ).await;
        });

        info!("DLQ replay loops spawned for all tables");
    }

    // Create the application state, wrapping shared resources in Arc
    let state = Arc::new(AppState {
        metrics_record_sender,
        log_record_sender,
        data_record_sender,
        files_record_sender,
        clickhouse_client,
        db: db.clone(),
        dlq_config: dlq_config.clone(),
        config: config.clone(),
    });

    // Define the Axum application router, merging routes from different modules
    let app = Router::new()
        .merge(health::router())
        .merge(ingest::router())
        .merge(step::router())
        .merge(files::router())
        .with_state(state); // Provide the application state to the routes

    // Define the server address (IPv6)
    let ipv6 = SocketAddr::from(([0, 0, 0, 0, 0, 0, 0, 0], 3003));
    tracing::info!(address = %ipv6, "Server starting to listen");

    // Bind the TCP listener and start the Axum server
    let ipv6_listener = TcpListener::bind(ipv6).await.unwrap();
    axum::serve(ipv6_listener, app.into_make_service())
        .await
        .unwrap();
}
