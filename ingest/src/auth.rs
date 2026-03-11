use axum::http::HeaderMap;
use tracing::{debug, instrument};

use crate::db::Database;
use crate::error::{invalid_auth_error, AppError, ErrorCode};

/// Extract and validate the bearer token from headers without hitting the database.
/// Returns the trimmed token string on success.
pub fn extract_bearer_token(headers: &HeaderMap) -> Result<String, AppError> {
    let auth_header = headers.get("Authorization").ok_or_else(|| {
        AppError::new(ErrorCode::MissingToken, "Missing Authorization header")
    })?;

    let auth_str = auth_header.to_str().map_err(|_| {
        AppError::new(
            ErrorCode::InvalidTokenFormat,
            "Authorization header contains invalid characters",
        )
    })?;

    if !auth_str.starts_with("Bearer ") {
        return Err(AppError::new(
            ErrorCode::InvalidBearerFormat,
            "Authorization header must start with 'Bearer '",
        ));
    }

    let token = auth_str[7..].trim();

    if token.is_empty() {
        return Err(invalid_auth_error("Bearer token cannot be empty"));
    }

    if !token
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(AppError::new(
            ErrorCode::InvalidTokenFormat,
            "Bearer token contains invalid characters",
        ));
    }

    Ok(token.to_string())
}
#[derive(Debug, Clone)]
pub struct Auth {
    pub tenant_id: String,
}

#[instrument(skip(headers, db), fields(token_prefix = tracing::field::Empty))]
pub async fn auth(headers: &HeaderMap, db: &Database) -> Result<Auth, AppError> {
    debug!("Attempting authentication");
    let token = extract_bearer_token(headers)?;

    // Record prefix for easier debugging without logging full token
    tracing::Span::current().record("token_prefix", &token.chars().take(8).collect::<String>());

    debug!("Token extracted, querying database for tenant ID");
    let tenant_id = db.get_tenant_by_api_key(&token).await?;
    debug!(tenant_id = %tenant_id, "Authentication successful");

    Ok(Auth { tenant_id })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    #[test]
    fn test_missing_authorization_header() {
        let headers = HeaderMap::new();
        let result = extract_bearer_token(&headers);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err.code, ErrorCode::MissingToken));
    }

    #[test]
    fn test_non_bearer_auth() {
        let mut headers = HeaderMap::new();
        headers.insert("Authorization", "Basic abc123".parse().unwrap());
        let result = extract_bearer_token(&headers);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err.code, ErrorCode::InvalidBearerFormat));
    }

    #[test]
    fn test_empty_bearer_token() {
        let mut headers = HeaderMap::new();
        headers.insert("Authorization", "Bearer ".parse().unwrap());
        let result = extract_bearer_token(&headers);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err.code, ErrorCode::InvalidToken));
    }

    #[test]
    fn test_bearer_token_with_invalid_chars() {
        let mut headers = HeaderMap::new();
        headers.insert("Authorization", "Bearer abc!@#$%".parse().unwrap());
        let result = extract_bearer_token(&headers);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err.code, ErrorCode::InvalidTokenFormat));
    }

    #[test]
    fn test_valid_bearer_token() {
        let mut headers = HeaderMap::new();
        headers.insert("Authorization", "Bearer test-api-key_123.abc".parse().unwrap());
        let result = extract_bearer_token(&headers);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "test-api-key_123.abc");
    }

    #[test]
    fn test_bearer_token_with_whitespace_trimming() {
        let mut headers = HeaderMap::new();
        headers.insert("Authorization", "Bearer   mytoken123  ".parse().unwrap());
        let result = extract_bearer_token(&headers);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "mytoken123");
    }

    #[test]
    fn test_mlpi_prefixed_token() {
        let mut headers = HeaderMap::new();
        headers.insert("Authorization", "Bearer mlpi_abc123".parse().unwrap());
        let result = extract_bearer_token(&headers);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "mlpi_abc123");
    }

    #[test]
    fn test_bearer_only_whitespace() {
        let mut headers = HeaderMap::new();
        headers.insert("Authorization", "Bearer    ".parse().unwrap());
        let result = extract_bearer_token(&headers);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err.code, ErrorCode::InvalidToken));
    }
}
