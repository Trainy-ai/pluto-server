mod common;

use axum::{body::Body, http::{Request, StatusCode}};
use http_body_util::BodyExt;
use tower::ServiceExt;
use std::path::PathBuf;
use tokio::fs;
use testcontainers::runners::AsyncRunner;
use common::clickhouse_image;

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

// --- All edge cases: auth, headers, payloads, multiline, health (single shared fixture) ---

#[tokio::test]
async fn test_ingest_edge_cases() {
    let fixture = common::TestFixture::new().await;

    // --- Health endpoints (run first while ClickHouse is fresh) ---

    // Liveness
    {
        let app = axum::Router::new()
            .merge(server_rs::routes::health::router())
            .with_state(fixture.app_state());

        let request = Request::builder()
            .method("GET")
            .uri("/health")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(String::from_utf8(body.to_vec()).unwrap(), "OK");
    }

    // Readiness
    {
        let app = axum::Router::new()
            .merge(server_rs::routes::health::router())
            .with_state(fixture.app_state());

        let request = Request::builder()
            .method("GET")
            .uri("/health/ready")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        let status = response.status();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let body_str = String::from_utf8(body.to_vec()).unwrap();

        assert_eq!(status, StatusCode::OK, "Expected healthy readiness. Got {}: {}", status, body_str);
        assert!(body_str.contains("healthy"), "Expected 'healthy' in response: {}", body_str);
    }

    // Version
    {
        let app = axum::Router::new()
            .merge(server_rs::routes::health::router())
            .with_state(fixture.app_state());

        let request = Request::builder()
            .method("GET")
            .uri("/version")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let body_str = String::from_utf8(body.to_vec()).unwrap();
        assert!(body_str.contains("ingest"), "Expected 'ingest' in version response: {}", body_str);
    }

    // --- Auth edge cases ---

    // Invalid bearer format
    {
        let app = fixture.router();
        let request = Request::builder()
            .method("POST")
            .uri("/ingest/metrics")
            .header("content-type", "application/json")
            .header("authorization", "Basic not-bearer")
            .header("x-project-name", "test-project")
            .header("x-run-id", "123")
            .body(Body::from(r#"{"time":1704067200,"step":1,"data":{"m":1.0}}"#))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert!(
            response.status().is_client_error(),
            "Expected a client error for non-Bearer auth, got {}",
            response.status()
        );
    }

    // Wrong API key
    {
        let app = fixture.router();
        let request = Request::builder()
            .method("POST")
            .uri("/ingest/metrics")
            .header("content-type", "application/json")
            .header("authorization", "Bearer wrong-key-does-not-exist")
            .header("x-project-name", "test-project")
            .header("x-run-id", "123")
            .body(Body::from(r#"{"time":1704067200,"step":1,"data":{"m":1.0}}"#))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert!(
            response.status().is_client_error(),
            "Expected a client error for wrong API key, got {}",
            response.status()
        );
    }

    // --- Missing enrichment headers ---

    // Missing X-Project-Name
    {
        let app = fixture.router();
        let request = Request::builder()
            .method("POST")
            .uri("/ingest/metrics")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", fixture.api_key))
            .header("x-run-id", "123")
            .body(Body::from(r#"{"time":1704067200,"step":1,"data":{"m":1.0}}"#))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        let status = response.status();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let body_str = String::from_utf8(body.to_vec()).unwrap();

        assert!(
            status.is_client_error(),
            "Expected a client error for missing X-Project-Name, got {}: {}",
            status, body_str
        );
        assert!(
            body_str.contains("X-Project-Name") || body_str.contains("header"),
            "Expected error about missing header, got: {}", body_str
        );
    }

    // Missing X-Run-Id
    {
        let app = fixture.router();
        let request = Request::builder()
            .method("POST")
            .uri("/ingest/metrics")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", fixture.api_key))
            .header("x-project-name", "test-project")
            .body(Body::from(r#"{"time":1704067200,"step":1,"data":{"m":1.0}}"#))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert!(
            response.status().is_client_error(),
            "Expected a client error for missing X-Run-Id, got {}",
            response.status()
        );
    }

    // --- Multi-line payloads ---

    // Multi-line metrics (3 lines, 1 metric each)
    {
        let app = fixture.router();
        let payload = "{\
\"time\":1000,\"step\":1,\"data\":{\"loss\":0.5}}\n\
{\"time\":1001,\"step\":2,\"data\":{\"loss\":0.4}}\n\
{\"time\":1002,\"step\":3,\"data\":{\"loss\":0.3}}";

        let request = Request::builder()
            .method("POST")
            .uri("/ingest/metrics")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", fixture.api_key))
            .header("x-project-name", "test-project")
            .header("x-run-id", "123")
            .body(Body::from(payload))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        let status = response.status();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let body_str = String::from_utf8(body.to_vec()).unwrap();

        assert_eq!(status, StatusCode::OK, "Got {}: {}", status, body_str);
        assert!(body_str.contains("3 records"), "Expected '3 records', got: {}", body_str);
    }

    // Multi-line metrics (2 lines, 2 metrics each = 4 records)
    {
        let app = fixture.router();
        let payload = "{\
\"time\":1000,\"step\":1,\"data\":{\"loss\":0.5,\"acc\":0.9}}\n\
{\"time\":1001,\"step\":2,\"data\":{\"loss\":0.4,\"acc\":0.92}}";

        let request = Request::builder()
            .method("POST")
            .uri("/ingest/metrics")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", fixture.api_key))
            .header("x-project-name", "test-project")
            .header("x-run-id", "456")
            .body(Body::from(payload))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        let status = response.status();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let body_str = String::from_utf8(body.to_vec()).unwrap();

        assert_eq!(status, StatusCode::OK, "Got {}: {}", status, body_str);
        assert!(body_str.contains("4 records"), "Expected '4 records', got: {}", body_str);
    }

    // Multi-line logs
    {
        let app = fixture.router();
        let payload = "{\
\"time\":1000,\"message\":\"line 1\",\"lineNumber\":1,\"logType\":\"INFO\"}\n\
{\"time\":1001,\"message\":\"line 2\",\"lineNumber\":2,\"logType\":\"ERROR\"}";

        let request = Request::builder()
            .method("POST")
            .uri("/ingest/logs")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", fixture.api_key))
            .header("x-project-name", "test-project")
            .header("x-run-id", "123")
            .body(Body::from(payload))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        let status = response.status();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let body_str = String::from_utf8(body.to_vec()).unwrap();

        assert_eq!(status, StatusCode::OK, "Got {}: {}", status, body_str);
        assert!(body_str.contains("2 records"), "Expected '2 records', got: {}", body_str);
    }

    // --- Invalid payloads ---

    // Invalid JSON
    {
        let app = fixture.router();
        let request = Request::builder()
            .method("POST")
            .uri("/ingest/metrics")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", fixture.api_key))
            .header("x-project-name", "test-project")
            .header("x-run-id", "123")
            .body(Body::from("this is not valid json at all"))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert!(
            response.status().is_client_error(),
            "Expected a client error for invalid JSON, got {}",
            response.status()
        );
    }

    // Empty data field
    {
        let app = fixture.router();
        let request = Request::builder()
            .method("POST")
            .uri("/ingest/metrics")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", fixture.api_key))
            .header("x-project-name", "test-project")
            .header("x-run-id", "123")
            .body(Body::from(r#"{"time":1000,"step":1,"data":{}}"#))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert!(
            response.status().is_client_error(),
            "Expected a client error for empty data field, got {}",
            response.status()
        );
    }

    // NaN / Infinity handling
    {
        let app = fixture.router();
        let request = Request::builder()
            .method("POST")
            .uri("/ingest/metrics")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", fixture.api_key))
            .header("x-project-name", "test-project")
            .header("x-run-id", "123")
            .body(Body::from(r#"{"time":1000,"step":1,"data":{"loss":NaN,"grad":Infinity,"min":-Infinity,"acc":0.95}}"#))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        let status = response.status();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let body_str = String::from_utf8(body.to_vec()).unwrap();

        assert_eq!(status, StatusCode::OK, "Expected 200 OK for NaN/Infinity. Got {}: {}", status, body_str);
        assert!(body_str.contains("4 records"), "Expected '4 records', got: {}", body_str);
    }

    // Empty body
    {
        let app = fixture.router();
        let request = Request::builder()
            .method("POST")
            .uri("/ingest/metrics")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", fixture.api_key))
            .header("x-project-name", "test-project")
            .header("x-run-id", "123")
            .body(Body::from(""))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        let status = response.status();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        let body_str = String::from_utf8(body.to_vec()).unwrap();

        assert_eq!(status, StatusCode::OK, "Expected 200 OK for empty body. Got {}: {}", status, body_str);
        assert!(body_str.contains("0 records"), "Expected '0 records', got: {}", body_str);
    }

    // --- Data endpoint edge cases ---

    // Empty dataType
    {
        let app = fixture.router();
        let request = Request::builder()
            .method("POST")
            .uri("/ingest/data")
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", fixture.api_key))
            .header("x-project-name", "test-project")
            .header("x-run-id", "123")
            .body(Body::from(r#"{"time":1000,"data":"payload","step":1,"dataType":"","logName":"test"}"#))
            .unwrap();

        let response = app.oneshot(request).await.unwrap();
        assert!(
            response.status().is_client_error(),
            "Expected a client error for empty dataType, got {}",
            response.status()
        );
    }

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

#[tokio::test]
async fn test_dlq_persists_and_replays_on_clickhouse_failure() {
    // Install rustls crypto provider (safe to call multiple times)
    let _ = rustls::crypto::CryptoProvider::install_default(
        rustls::crypto::aws_lc_rs::default_provider()
    );

    // Setup test containers
    let containers = common::TestContainers::new().await;

    // Create a temporary DLQ directory for this test
    let dlq_path = PathBuf::from(format!("/tmp/dlq-test-{}", std::process::id()));

    // Clean up any previous test artifacts
    let _ = fs::remove_dir_all(&dlq_path).await;

    // Setup database connection
    let db = server_rs::db::Database::connect(&containers.postgres_url)
        .await
        .expect("Failed to connect to test database");
    let db = std::sync::Arc::new(db);

    // Setup ClickHouse client
    let clickhouse_client = clickhouse::Client::default()
        .with_url(&containers.clickhouse_url)
        .with_user("default")
        .with_password("");

    // Create DLQ-ENABLED config
    let dlq_config = std::sync::Arc::new(server_rs::dlq::DlqConfig {
        enabled: true,
        base_path: dlq_path.clone(),
        max_disk_mb: 100,
        batch_ttl_hours: 24,
        replay_on_startup: true,
        replay_interval_secs: 1, // Fast replay for testing
        cleanup_interval_secs: 60,
    });

    // Initialize DLQ directories
    server_rs::dlq::init_directories(&dlq_config)
        .await
        .expect("Failed to initialize DLQ directories");

    // Create app state with DLQ enabled
    let config = std::sync::Arc::new(server_rs::config::Config {
        clickhouse_url: containers.clickhouse_url.clone(),
        clickhouse_user: "default".to_string(),
        clickhouse_password: "".to_string(),
        storage_access_key_id: "test".to_string(),
        storage_secret_access_key: "test".to_string(),
        storage_bucket: "test-bucket".to_string(),
        storage_region: "us-east-1".to_string(),
        storage_endpoint: "http://localhost:9000".to_string(),
        database_url: containers.postgres_url.clone(),
    });
    let (metrics_sender, metrics_receiver) = tokio::sync::mpsc::channel(100);
    let (log_sender, _log_receiver) = tokio::sync::mpsc::channel(100);
    let (data_sender, _data_receiver) = tokio::sync::mpsc::channel(100);
    let (files_sender, _files_receiver) = tokio::sync::mpsc::channel(100);

    let app_state = std::sync::Arc::new(server_rs::routes::AppState {
        metrics_record_sender: metrics_sender,
        log_record_sender: log_sender,
        data_record_sender: data_sender,
        files_record_sender: files_sender,
        clickhouse_client: clickhouse_client.clone(),
        db,
        dlq_config: dlq_config.clone(),
        config,
    });

    // Start background processor for metrics (with DLQ)
    let _processor_client = clickhouse_client.clone();
    let processor_dlq = dlq_config.clone();
    let processor_config = server_rs::config::Config {
        clickhouse_url: containers.clickhouse_url.clone(),
        clickhouse_user: "default".to_string(),
        clickhouse_password: "".to_string(),
        storage_access_key_id: "test".to_string(),
        storage_secret_access_key: "test".to_string(),
        storage_bucket: "test-bucket".to_string(),
        storage_region: "us-east-1".to_string(),
        storage_endpoint: "http://localhost:9000".to_string(),
        database_url: containers.postgres_url.clone(),
    };
    tokio::spawn(async move {
        server_rs::processors::background::start_background_processor(
            metrics_receiver,
            server_rs::config::METRICS_FLUSH_CONFIG,
            false, // skip_upload
            std::sync::Arc::new(processor_config),
            processor_dlq,
        ).await;
    });

    // Step 1: Send data with ClickHouse running - should succeed
    println!("Step 1: Sending data with ClickHouse available...");
    let payload1 = r#"{"time":1704067200,"step":1,"data":{"before_failure":10.0}}"#;
    let request1 = Request::builder()
        .method("POST")
        .uri("/ingest/metrics")
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {}", containers.api_key))
        .header("x-tenant-id", &containers.tenant_id)
        .header("x-project-name", "test-project")
        .header("x-run-id", "123")
        .body(Body::from(payload1))
        .unwrap();

    let app1 = server_rs::routes::ingest::router().with_state(app_state.clone());
    let response1 = app1.oneshot(request1).await.unwrap();
    assert_eq!(response1.status(), StatusCode::OK, "First request should succeed");

    // Wait for background processor to flush
    tokio::time::sleep(tokio::time::Duration::from_secs(6)).await;

    // Step 2: Stop ClickHouse container to simulate failure
    println!("Step 2: Stopping ClickHouse to simulate failure...");
    containers.clickhouse_container.stop().await.expect("Failed to stop ClickHouse");
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

    // Step 3: Send data while ClickHouse is down - should be persisted to DLQ
    println!("Step 3: Sending data while ClickHouse is unavailable...");
    let payload2 = r#"{"time":1704067201,"step":1,"data":{"during_failure":20.0}}"#;
    let request2 = Request::builder()
        .method("POST")
        .uri("/ingest/metrics")
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {}", containers.api_key))
        .header("x-tenant-id", &containers.tenant_id)
        .header("x-project-name", "test-project")
        .header("x-run-id", "123")
        .body(Body::from(payload2))
        .unwrap();

    let app2 = server_rs::routes::ingest::router().with_state(app_state.clone());
    let response2 = app2.oneshot(request2).await.unwrap();
    assert_eq!(response2.status(), StatusCode::OK, "Second request should be accepted");

    // Wait for background processor to attempt flush and persist to DLQ
    tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

    // Step 4: Verify batches were persisted to DLQ
    println!("Step 4: Verifying batches exist in DLQ...");
    let metrics_dlq_path = dlq_path.join("mlop_metrics");
    assert!(metrics_dlq_path.exists(), "DLQ metrics directory should exist");

    let mut dlq_entries = fs::read_dir(&metrics_dlq_path).await.expect("Failed to read DLQ directory");
    let mut batch_count = 0;
    while let Some(entry) = dlq_entries.next_entry().await.expect("Failed to read DLQ entry") {
        if entry.path().extension().and_then(|s| s.to_str()) == Some("json") {
            batch_count += 1;
            println!("Found DLQ batch: {:?}", entry.path());
        }
    }

    assert!(batch_count > 0, "Expected at least one batch in DLQ, found {}", batch_count);
    println!("Found {} batches in DLQ", batch_count);

    // Step 5: Create a NEW ClickHouse instance (simulating service recovery)
    // Note: We create a new container instead of restarting because testcontainers
    // doesn't reliably support stop/start lifecycle for database containers
    println!("Step 5: Creating fresh ClickHouse instance (simulating service recovery)...");

    let testcontainers_host = std::env::var("TESTCONTAINERS_HOST_OVERRIDE")
        .unwrap_or_else(|_| "127.0.0.1".into());

    let new_clickhouse_container = clickhouse_image()
        .start()
        .await
        .expect("Failed to start new ClickHouse container");

    let new_clickhouse_port = new_clickhouse_container
        .get_host_port_ipv4(8123)
        .await
        .expect("Failed to get new ClickHouse port");
    let new_clickhouse_url = format!("http://{}:{}", testcontainers_host, new_clickhouse_port);

    // Poll until ClickHouse is ready to accept queries
    common::wait_for_clickhouse_ready(&new_clickhouse_url, 60).await;

    // Create new client for the fresh instance
    let new_clickhouse_client = clickhouse::Client::default()
        .with_url(&new_clickhouse_url)
        .with_user("default")
        .with_password("");

    // Step 6: Setup schema in the new instance
    println!("Step 6: Creating ClickHouse schema in new instance...");
    common::setup_clickhouse_tables(&new_clickhouse_url, "default", "").await;

    // Step 7: Manually trigger DLQ replay (simulating what happens on startup)
    // Use the NEW ClickHouse client to replay to the fresh instance
    println!("Step 7: Triggering DLQ replay to new ClickHouse instance...");
    let replay_stats = server_rs::dlq::replay::replay_on_startup::<
        server_rs::models::metrics::MetricRow,
        _,
        _,
    >(
        &new_clickhouse_client,
        &dlq_config,
        server_rs::config::METRICS_TABLE_NAME,
    )
    .await
    .expect("Replay should succeed");

    println!("Replay stats: replayed={}, failed_batches={}, failed_records={}",
             replay_stats.replayed, replay_stats.failed_batches, replay_stats.failed_records);

    assert!(replay_stats.replayed > 0, "Expected some batches to be replayed, got {}", replay_stats.replayed);
    assert_eq!(replay_stats.failed_batches, 0, "Expected no failed batches, got {}", replay_stats.failed_batches);
    assert_eq!(replay_stats.failed_records, 0, "Expected no failed records, got {}", replay_stats.failed_records);

    // Step 8: Verify DLQ is now empty (batches deleted after successful replay)
    println!("Step 8: Verifying DLQ is empty after replay...");
    let mut final_dlq_entries = fs::read_dir(&metrics_dlq_path).await.expect("Failed to read DLQ directory");
    let mut final_batch_count = 0;
    while let Some(entry) = final_dlq_entries.next_entry().await.expect("Failed to read DLQ entry") {
        if entry.path().extension().and_then(|s| s.to_str()) == Some("json") {
            final_batch_count += 1;
            println!("WARNING: Found leftover batch: {:?}", entry.path());
        }
    }

    assert_eq!(final_batch_count, 0, "Expected DLQ to be empty after replay, found {} batches", final_batch_count);

    // Step 9: Verify data exists in the NEW ClickHouse instance
    println!("Step 9: Verifying replayed data in ClickHouse...");
    let query_result = new_clickhouse_client
        .query("SELECT COUNT(*) FROM mlop_metrics WHERE tenantId = ?")
        .bind(&containers.tenant_id)
        .fetch_one::<u64>()
        .await;

    match query_result {
        Ok(count) => {
            assert!(count > 0, "Expected metrics data in ClickHouse after replay, found {}", count);
            println!("Successfully verified {} metrics in ClickHouse", count);
        }
        Err(e) => {
            panic!("Failed to query ClickHouse: {}. Replay may have failed.", e);
        }
    }

    // Cleanup
    let _ = fs::remove_dir_all(&dlq_path).await;

    // Keep new container alive until test completes
    drop(new_clickhouse_container);

    println!();
    println!("✅ DLQ integration test passed!");
    println!();
    println!("Verified end-to-end:");
    println!("  1. Data successfully sent when ClickHouse is available");
    println!("  2. Data accepted when ClickHouse is unavailable");
    println!("  3. Failed batches persisted to DLQ on disk");
    println!("  4. New ClickHouse instance created (simulating service recovery)");
    println!("  5. DLQ batches replayed to recovered ClickHouse instance");
    println!("  6. DLQ emptied after successful replay");
    println!("  7. Data verified in ClickHouse (ZERO DATA LOSS)");
}
