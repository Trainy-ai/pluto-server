mod auth;
mod config;
mod db;
mod error;
mod models;
mod processors;
mod routes;
mod traits;
mod utils;

use axum::Router;
use clap::Parser;
use clickhouse::Client;
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

    // Spawn background processors for each data type
    // These processors receive data through channels and upload it
    tokio::spawn(start_background_processor(
        metrics_record_receiver,
        METRICS_FLUSH_CONFIG,
        skip_upload,
        config.clone(),
    ));

    tokio::spawn(start_background_processor(
        log_record_receiver,
        LOGS_FLUSH_CONFIG,
        skip_upload,
        config.clone(),
    ));

    tokio::spawn(start_background_processor(
        data_record_receiver,
        DATA_FLUSH_CONFIG,
        skip_upload,
        config.clone(),
    ));

    tokio::spawn(start_background_processor(
        files_record_receiver,
        FILES_FLUSH_CONFIG,
        skip_upload,
        config.clone(),
    ));

    // Create the application state, wrapping shared resources in Arc
    let state = Arc::new(AppState {
        metrics_record_sender,
        log_record_sender,
        data_record_sender,
        files_record_sender,
        clickhouse_client,
        db: db.clone(),
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
