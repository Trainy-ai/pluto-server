use axum::http::HeaderMap;
use tracing::{debug, instrument, warn};

use crate::db::Database;
use crate::error::{invalid_auth_error, AppError, ErrorCode};
#[derive(Debug, Clone)]
pub struct Auth {
    pub tenant_id: String,
}

#[instrument(skip(headers, db), fields(token_prefix = tracing::field::Empty))]
pub async fn auth(headers: &HeaderMap, db: &Database) -> Result<Auth, AppError> {
    debug!("Attempting authentication");
    let auth_header = headers.get("Authorization").ok_or_else(|| {
        warn!("Missing Authorization header");
        AppError::new(ErrorCode::MissingToken, "Missing Authorization header")
    })?;

    let auth_str = auth_header.to_str().map_err(|_| {
        warn!("Invalid characters in Authorization header");
        AppError::new(
            ErrorCode::InvalidTokenFormat,
            "Authorization header contains invalid characters",
        )
    })?;

    if !auth_str.starts_with("Bearer ") {
        warn!("Authorization header does not start with 'Bearer '");
        return Err(AppError::new(
            ErrorCode::InvalidBearerFormat,
            "Authorization header must start with 'Bearer '",
        ));
    }

    let token = auth_str[7..].trim();
    // Record prefix for easier debugging without logging full token
    tracing::Span::current().record("token_prefix", &token.chars().take(8).collect::<String>());

    if token.is_empty() {
        warn!("Empty Bearer token provided");
        return Err(invalid_auth_error("Bearer token cannot be empty"));
    }

    // Basic token character validation (can be enhanced)
    if !token
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        warn!(token_prefix = %token.chars().take(8).collect::<String>(), "Bearer token contains invalid characters");
        return Err(AppError::new(
            ErrorCode::InvalidTokenFormat,
            "Bearer token contains invalid characters",
        ));
    }

    debug!("Token extracted, querying database for tenant ID");
    let tenant_id = db.get_tenant_by_api_key(token).await?;
    debug!(tenant_id = %tenant_id, "Authentication successful");

    Ok(Auth { tenant_id })
}
