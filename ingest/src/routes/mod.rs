use clickhouse::Client;
use std::sync::Arc;
use tokio::sync::mpsc;

use crate::config::Config;
use crate::db::Database;
use crate::models::{data::DataRow, files::FilesRow, log::LogRow, metrics::MetricRow};

pub mod files;
pub mod health;
pub mod ingest;
pub mod step;

// Holds the shared state for the Axum application
#[derive(Clone)]
pub struct AppState {
    // Sender channels for various data types to background processors
    pub metrics_record_sender: mpsc::Sender<MetricRow>,
    pub log_record_sender: mpsc::Sender<LogRow>,
    pub data_record_sender: mpsc::Sender<DataRow>,
    pub files_record_sender: mpsc::Sender<FilesRow>,
    // ClickHouse client for direct interaction if needed
    pub clickhouse_client: Client,
    // Arc-wrapped primary database connection pool
    pub db: Arc<Database>,
    // Arc-wrapped application configuration
    pub config: Arc<Config>,
}
