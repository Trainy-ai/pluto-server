use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    // Authentication/Authorization Errors (1xxx)
    AuthenticationFailed = 1001,
    InvalidToken = 1002,
    MissingToken = 1003,
    MissingTenantId = 1004,
    TokenExpired = 1005,
    InvalidTokenFormat = 1006,
    InvalidBearerFormat = 1007,
    InsufficientPermissions = 1008,

    // Input Validation Errors (2xxx)
    InvalidInput = 2001,
    MissingRequiredField = 2002,
    InvalidJsonFormat = 2003,
    InvalidHeaderFormat = 2004,
    InvalidMetricFormat = 2005,
    InvalidLogFormat = 2006,
    InvalidTimestamp = 2007,
    InvalidStepValue = 2008,

    // Processing Errors (3xxx)
    ProcessingFailed = 3001,
    StreamProcessingError = 3002,
    BatchProcessingError = 3003,
    StreamDecodingError = 3004,
    DataTransformationError = 3005,
    BufferOverflowError = 3006,

    // Database Errors (4xxx)
    DatabaseError = 4001,
    InsertFailed = 4002,
    ConnectionFailed = 4003,
    QueryFailed = 4004,
    DatabaseTimeout = 4005,
    BatchInsertFailed = 4006,
    DatabaseUnavailable = 4007,

    // System Errors (5xxx)
    InternalError = 5001,
    ServiceUnavailable = 5002,
    ConfigurationError = 5003,
    ResourceExhausted = 5004,
    RateLimitExceeded = 5005,
    ServiceOverloaded = 5006,
}

impl ErrorCode {
    pub fn status_code(&self) -> StatusCode {
        match self {
            // Auth errors -> 401/403
            ErrorCode::AuthenticationFailed => StatusCode::UNAUTHORIZED,
            ErrorCode::InvalidToken => StatusCode::UNAUTHORIZED,
            ErrorCode::MissingToken => StatusCode::UNAUTHORIZED,
            ErrorCode::MissingTenantId => StatusCode::UNAUTHORIZED,
            ErrorCode::TokenExpired => StatusCode::UNAUTHORIZED,
            ErrorCode::InvalidTokenFormat => StatusCode::UNAUTHORIZED,
            ErrorCode::InvalidBearerFormat => StatusCode::UNAUTHORIZED,
            ErrorCode::InsufficientPermissions => StatusCode::FORBIDDEN,

            // Input validation -> 400
            ErrorCode::InvalidInput => StatusCode::BAD_REQUEST,
            ErrorCode::MissingRequiredField => StatusCode::BAD_REQUEST,
            ErrorCode::InvalidJsonFormat => StatusCode::BAD_REQUEST,
            ErrorCode::InvalidHeaderFormat => StatusCode::BAD_REQUEST,
            ErrorCode::InvalidMetricFormat => StatusCode::BAD_REQUEST,
            ErrorCode::InvalidLogFormat => StatusCode::BAD_REQUEST,
            ErrorCode::InvalidTimestamp => StatusCode::BAD_REQUEST,
            ErrorCode::InvalidStepValue => StatusCode::BAD_REQUEST,

            // Processing errors -> 422
            ErrorCode::ProcessingFailed => StatusCode::UNPROCESSABLE_ENTITY,
            ErrorCode::StreamProcessingError => StatusCode::UNPROCESSABLE_ENTITY,
            ErrorCode::BatchProcessingError => StatusCode::UNPROCESSABLE_ENTITY,
            ErrorCode::StreamDecodingError => StatusCode::UNPROCESSABLE_ENTITY,
            ErrorCode::DataTransformationError => StatusCode::UNPROCESSABLE_ENTITY,
            ErrorCode::BufferOverflowError => StatusCode::UNPROCESSABLE_ENTITY,

            // Database errors -> 503/500
            ErrorCode::DatabaseError => StatusCode::SERVICE_UNAVAILABLE,
            ErrorCode::InsertFailed => StatusCode::SERVICE_UNAVAILABLE,
            ErrorCode::ConnectionFailed => StatusCode::SERVICE_UNAVAILABLE,
            ErrorCode::QueryFailed => StatusCode::SERVICE_UNAVAILABLE,
            ErrorCode::DatabaseTimeout => StatusCode::GATEWAY_TIMEOUT,
            ErrorCode::BatchInsertFailed => StatusCode::SERVICE_UNAVAILABLE,
            ErrorCode::DatabaseUnavailable => StatusCode::SERVICE_UNAVAILABLE,

            // System errors -> 500/503/429
            ErrorCode::InternalError => StatusCode::INTERNAL_SERVER_ERROR,
            ErrorCode::ServiceUnavailable => StatusCode::SERVICE_UNAVAILABLE,
            ErrorCode::ConfigurationError => StatusCode::INTERNAL_SERVER_ERROR,
            ErrorCode::ResourceExhausted => StatusCode::TOO_MANY_REQUESTS,
            ErrorCode::RateLimitExceeded => StatusCode::TOO_MANY_REQUESTS,
            ErrorCode::ServiceOverloaded => StatusCode::SERVICE_UNAVAILABLE,
        }
    }

    pub fn error_type(&self) -> &'static str {
        let code = *self as u16;
        match code {
            1001..=1999 => "Authentication Error",
            2001..=2999 => "Validation Error",
            3001..=3999 => "Processing Error",
            4001..=4999 => "Database Error",
            5001..=5999 => "System Error",
            _ => "Unknown Error",
        }
    }
}

impl fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}", self)
    }
}

#[derive(Debug)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    pub details: Option<serde_json::Value>,
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} ({} - {}): {}",
            self.code,
            self.code as u16,
            self.code.error_type(),
            self.message
        )
    }
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
        }
    }

    #[allow(dead_code)]
    pub fn with_details(
        code: ErrorCode,
        message: impl Into<String>,
        details: serde_json::Value,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            details: Some(details),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.code.status_code();
        let body = ErrorResponse {
            code: self.code,
            message: self.message,
            details: self.details,
        };

        (status, Json(body)).into_response()
    }
}

// Conversion from various error types to AppError
impl From<clickhouse::error::Error> for AppError {
    fn from(err: clickhouse::error::Error) -> Self {
        AppError::new(
            ErrorCode::DatabaseError,
            format!("Database operation failed: {}", err),
        )
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::new(
            ErrorCode::InvalidJsonFormat,
            format!("JSON parsing failed: {}", err),
        )
    }
}

impl From<StatusCode> for AppError {
    fn from(status: StatusCode) -> Self {
        let code = match status {
            StatusCode::UNAUTHORIZED => ErrorCode::AuthenticationFailed,
            StatusCode::FORBIDDEN => ErrorCode::InsufficientPermissions,
            StatusCode::BAD_REQUEST => ErrorCode::InvalidInput,
            StatusCode::UNPROCESSABLE_ENTITY => ErrorCode::ProcessingFailed,
            StatusCode::TOO_MANY_REQUESTS => ErrorCode::RateLimitExceeded,
            StatusCode::SERVICE_UNAVAILABLE => ErrorCode::ServiceUnavailable,
            StatusCode::GATEWAY_TIMEOUT => ErrorCode::DatabaseTimeout,
            _ => ErrorCode::InternalError,
        };

        AppError::new(code, status.canonical_reason().unwrap_or("Unknown error"))
    }
}

pub fn missing_header_error(header_name: &str) -> AppError {
    AppError::new(
        ErrorCode::InvalidHeaderFormat,
        format!("Missing required header: {}", header_name),
    )
}

pub fn invalid_auth_error(message: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::InvalidToken, message)
}
