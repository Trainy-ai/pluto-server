mod common;

use axum::{body::Body, http::{Request, StatusCode}};
use http_body_util::BodyExt;
use tower::ServiceExt;

#[tokio::test]
async fn test_ingest_metrics_endpoint() {
    // Setup test fixture
    let fixture = common::TestFixture::new().await;
    let app = fixture.router();

    // Create test request payload with correct format
    let payload = r#"{"time":1704067200,"step":1,"data":{"test_metric":42.5}}"#;

    // Make request to /ingest/metrics
    let request = Request::builder()
        .method("POST")
        .uri("/ingest/metrics")
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {}", fixture.api_key))
        .header("x-tenant-id", &fixture.tenant_id)
        .header("x-project-name", "test-project")
        .header("x-run-id", "123")
        .body(Body::from(payload))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    // Get response body for debugging
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body_str = String::from_utf8(body.to_vec()).unwrap();

    // Assert response
    assert_eq!(
        status,
        StatusCode::OK,
        "Expected 200 OK response for metrics ingestion. Got {}: {}",
        status,
        body_str
    );

    assert!(
        body_str.contains("processed") || body_str.contains("success"),
        "Expected success message in response body"
    );
}

#[tokio::test]
async fn test_ingest_logs_endpoint() {
    // Setup test fixture
    let fixture = common::TestFixture::new().await;
    let app = fixture.router();

    // Create test request payload with correct format
    let payload = r#"{"time":1704067200,"message":"test log message","lineNumber":1,"logType":"INFO"}"#;

    // Make request to /ingest/logs
    let request = Request::builder()
        .method("POST")
        .uri("/ingest/logs")
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {}", fixture.api_key))
        .header("x-tenant-id", &fixture.tenant_id)
        .header("x-project-name", "test-project")
        .header("x-run-id", "123")
        .body(Body::from(payload))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    // Assert response
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "Expected 200 OK response for logs ingestion"
    );
}

#[tokio::test]
async fn test_ingest_data_endpoint() {
    // Setup test fixture
    let fixture = common::TestFixture::new().await;
    let app = fixture.router();

    // Create test request payload with correct format
    let payload = r#"{"time":1704067200,"data":"test_value","step":1,"dataType":"test_data","logName":"test_log"}"#;

    // Make request to /ingest/data
    let request = Request::builder()
        .method("POST")
        .uri("/ingest/data")
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {}", fixture.api_key))
        .header("x-tenant-id", &fixture.tenant_id)
        .header("x-project-name", "test-project")
        .header("x-run-id", "123")
        .body(Body::from(payload))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    // Get response body for debugging
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body_str = String::from_utf8(body.to_vec()).unwrap();

    // Assert response
    assert_eq!(
        status,
        StatusCode::OK,
        "Expected 200 OK response for data ingestion. Got {}: {}",
        status,
        body_str
    );
}

#[tokio::test]
async fn test_ingest_metrics_without_auth_headers() {
    // Setup test fixture
    let fixture = common::TestFixture::new().await;
    let app = fixture.router();

    // Create test request payload with correct format
    let payload = r#"{"time":1704067200,"step":1,"data":{"test_metric":42.5}}"#;

    // Make request WITHOUT required headers
    let request = Request::builder()
        .method("POST")
        .uri("/ingest/metrics")
        .header("content-type", "application/json")
        // Missing x-tenant-id, x-project-name, x-run-id headers
        .body(Body::from(payload))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    // Get response body for debugging
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let body_str = String::from_utf8(body.to_vec()).unwrap();

    // Assert that request fails without proper headers
    // The API returns 422 for auth errors, not 400
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "Expected 422 response when missing auth headers. Got {}: {}",
        status,
        body_str
    );

    // Verify the error is about missing authorization
    assert!(
        body_str.contains("Authorization") || body_str.contains("auth"),
        "Expected error message about authorization, got: {}",
        body_str
    );
}
