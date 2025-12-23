use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use sqlx::postgres::{PgPool, PgPoolOptions};
use std::time::Duration;
use tracing::{error, info, instrument, warn};

use crate::error::{AppError, ErrorCode};

// Wrapper struct for the PostgreSQL connection pool
pub struct Database {
    pool: PgPool, // SQLx connection pool
}

// Represents an API key row fetched from the database
#[derive(sqlx::FromRow)]
#[allow(unused)] // Allow unused fields for now
pub struct ApiKey {
    pub id: String,
    pub organization_id: String, // Maps to "organizationId" column
    pub key: String,             // Hashed API key
    pub expires_at: Option<DateTime<Utc>>, // Optional expiration timestamp
    pub last_used: Option<DateTime<Utc>>, // Optional last used timestamp
    pub created_at: DateTime<Utc>, // Creation timestamp
}

// SQL query to fetch an API key by its hashed value
const GET_API_KEY_QUERY: &str = r#"
    SELECT id, "organizationId" as organization_id, "key" as key, 
           "expiresAt"::timestamptz as expires_at, "lastUsed"::timestamptz as last_used,
           "createdAt"::timestamptz as created_at
    FROM "api_key" 
    WHERE "key" = $1"#; // Parameter $1 is the hashed key

impl Database {
    // Establishes a connection pool to the PostgreSQL database
    #[instrument(skip(database_url))]
    pub async fn connect(database_url: &str) -> Result<Self, AppError> {
        info!("Attempting to connect to the database");
        let pool = PgPoolOptions::new()
            .max_connections(5) // Configure max number of connections
            .acquire_timeout(Duration::from_secs(3)) // Configure connection acquire timeout
            .connect(database_url) // Connect using the provided URL
            .await
            .map_err(|e| {
                // Log the original error for debugging
                error!(error = %e, "Failed to connect to database");
                // Return a generic AppError
                AppError::new(ErrorCode::DatabaseError, "Failed to connect to database")
            })?;

        info!("Successfully connected to the database");
        Ok(Self { pool })
    }

    // Hashes an API key using SHA256
    // Skips hashing if the key already starts with "mlpi_" (assumed pre-hashed or special format)
    // This prefix is used internally to identify keys that might have a different hashing mechanism or origin.
    fn hash_api_key(api_key: &str) -> String {
        if api_key.starts_with("mlpi_") {
            // Assume keys starting with "mlpi_" are already hashed or special
            api_key.to_string()
        } else {
            // Hash other keys using SHA256
            let mut hasher = Sha256::new();
            hasher.update(api_key.as_bytes());
            // Return the hex-encoded hash
            format!("{:x}", hasher.finalize())
        }
    }

    // Retrieves the tenant ID associated with a given API key
    // Hashes the key and queries the database
    #[instrument(skip(self, api_key))]
    pub async fn get_tenant_by_api_key(&self, api_key: &str) -> Result<String, AppError> {
        // Hash the provided API key
        let hashed_key = Self::hash_api_key(api_key);

        // Execute the prepared query to find the key
        let api_key_result = sqlx::query_as::<_, ApiKey>(GET_API_KEY_QUERY)
            .persistent(true) // Keep the prepared statement cached
            .bind(hashed_key) // Bind the hashed key to the query parameter
            .fetch_optional(&self.pool) // Expect zero or one result
            .await;

        let api_key = match api_key_result {
            Ok(Some(key)) => key,
            Ok(None) => {
                warn!("API key not found in database");
                return Err(AppError::new(ErrorCode::InvalidToken, "Invalid API key"));
            }
            Err(e) => {
                // Log the original database error
                error!(error = %e, "Database error while fetching API key");
                // Return a generic error to the client
                return Err(AppError::new(
                    ErrorCode::DatabaseError,
                    "Failed to validate API key",
                ));
            }
        };

        // Check if the key has expired
        if let Some(expires_at) = api_key.expires_at {
            if expires_at < Utc::now() {
                warn!(key_id = %api_key.id, tenant_id = %api_key.organization_id, expiry = %expires_at, "API key has expired");
                return Err(AppError::new(
                    ErrorCode::InvalidToken,
                    "API key has expired",
                ));
            }
        }

        // Return the organization ID (tenant ID) associated with the valid key
        Ok(api_key.organization_id.to_string())
    }
}
