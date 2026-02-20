use axum::http::HeaderMap;
use clickhouse::Row;
use serde::de::{MapAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;
use std::fmt;

use crate::{
    config::METRICS_TABLE_NAME,
    error::{missing_header_error, AppError, ErrorCode},
    processors::stream::IntoRows,
    traits::{DatabaseRow, EnrichmentData, InputData},
    utils::log_group_from_log_name,
};

type LogName = String;

/// A wrapper type for deserializing metric values that can be either:
/// - A JSON number (normal case)
/// - A JSON string `"NaN"`, `"Infinity"`, or `"-Infinity"` (produced by our
///   byte-level sanitizer from bare Python literals)
///
/// Maps string representations back to `f64::NAN`, `f64::INFINITY`, and
/// `f64::NEG_INFINITY` respectively, preserving them through to ClickHouse.
struct MetricValue(f64);

impl<'de> Deserialize<'de> for MetricValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct MetricValueVisitor;

        impl<'de> Visitor<'de> for MetricValueVisitor {
            type Value = MetricValue;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a number or special float string (NaN, Infinity, -Infinity)")
            }

            fn visit_f64<E>(self, v: f64) -> Result<Self::Value, E> {
                Ok(MetricValue(v))
            }

            fn visit_i64<E>(self, v: i64) -> Result<Self::Value, E> {
                Ok(MetricValue(v as f64))
            }

            fn visit_u64<E>(self, v: u64) -> Result<Self::Value, E> {
                Ok(MetricValue(v as f64))
            }

            fn visit_str<E: serde::de::Error>(self, v: &str) -> Result<Self::Value, E> {
                match v {
                    "NaN" => Ok(MetricValue(f64::NAN)),
                    "Infinity" => Ok(MetricValue(f64::INFINITY)),
                    "-Infinity" => Ok(MetricValue(f64::NEG_INFINITY)),
                    _ => Err(E::custom(format!(
                        "unexpected string metric value: '{}'",
                        v
                    ))),
                }
            }
        }

        deserializer.deserialize_any(MetricValueVisitor)
    }
}

/// Custom deserializer for the metric data map that handles:
/// - Normal numeric values (`f64`)
/// - String-encoded non-finite values (`"NaN"`, `"Infinity"`, `"-Infinity"`)
///   which are produced by our byte-level sanitizer
/// - `null` values (skipped)
///
/// This allows the ingest pipeline to gracefully handle `NaN`, `Infinity`, and
/// `-Infinity` values common in ML training (e.g., gradient norms, data statistics)
/// by preserving them as native `f64` special values through to ClickHouse, while
/// still ingesting all valid metrics from the same JSON line.
fn deserialize_metric_data<'de, D>(deserializer: D) -> Result<HashMap<LogName, f64>, D::Error>
where
    D: Deserializer<'de>,
{
    struct MetricDataVisitor;

    impl<'de> Visitor<'de> for MetricDataVisitor {
        type Value = HashMap<LogName, f64>;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a map of metric names to float values")
        }

        fn visit_map<M>(self, mut map: M) -> Result<HashMap<LogName, f64>, M::Error>
        where
            M: MapAccess<'de>,
        {
            let mut result = HashMap::new();
            while let Some(key) = map.next_key::<LogName>()? {
                // Deserialize as Option<MetricValue> to handle null gracefully
                match map.next_value::<Option<MetricValue>>()? {
                    Some(mv) => {
                        result.insert(key, mv.0);
                    }
                    None => {
                        // Skip null values
                    }
                }
            }
            Ok(result)
        }
    }

    deserializer.deserialize_map(MetricDataVisitor)
}

/// Raw input data for metrics
///
/// # Example
/// ```json
/// {
///     "time": 1234567890,
///     "step": 42,
///     "data": {
///         "accuracy": 0.95,
///         "loss": 0.123
///     }
/// }
/// ```
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MetricInput {
    pub time: u64,
    pub step: u64,
    #[serde(deserialize_with = "deserialize_metric_data")]
    pub data: HashMap<LogName, f64>,
}

impl MetricInput {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.data.is_empty() {
            return Err(AppError::new(
                ErrorCode::InvalidMetricFormat,
                "'data' field cannot be empty".to_string(),
            ));
        }

        for (key, _value) in &self.data {
            if key.trim().is_empty() {
                return Err(AppError::new(
                    ErrorCode::InvalidMetricFormat,
                    "metric name cannot be empty".to_string(),
                ));
            }
            // Non-finite values (NaN, Infinity, -Infinity) are allowed —
            // they are preserved through to ClickHouse Float64 which
            // supports them natively.
        }

        Ok(())
    }
}

impl InputData for MetricInput {
    fn validate(&self) -> Result<(), AppError> {
        self.validate()
    }
}

// Implement IntoRows for MetricInput to handle multiple metrics per input
impl IntoRows<MetricEnrichment, MetricRow> for MetricInput {
    fn into_rows(self, enrichment: MetricEnrichment) -> Result<Vec<MetricRow>, AppError> {
        self.validate()?;

        Ok(self
            .data
            .into_iter()
            .map(|(log_name, value)| MetricRow {
                time: self.time,
                step: self.step,
                log_group: log_group_from_log_name(&log_name),
                log_name,
                value,
                tenant_id: enrichment.tenant_id.clone(),
                run_id: enrichment.run_id.clone(),
                project_name: enrichment.project_name.clone(),
            })
            .collect())
    }
}

#[derive(Debug, Clone)]
pub struct MetricEnrichment {
    pub tenant_id: String,
    pub run_id: u64,
    pub project_name: String,
}

impl EnrichmentData for MetricEnrichment {
    fn from_headers(tenant_id: String, headers: &HeaderMap) -> Result<Self, AppError> {
        let run_id = headers
            .get("X-Run-Id")
            .and_then(|h| h.to_str().ok())
            .ok_or_else(|| missing_header_error("X-Run-Id"))?
            .parse::<u64>()
            .unwrap_or(0);

        let project_name = headers
            .get("X-Project-Name")
            .and_then(|h| h.to_str().ok())
            .ok_or_else(|| missing_header_error("X-Project-Name"))?
            .to_string();

        Ok(Self {
            tenant_id,
            run_id,
            project_name,
        })
    }
}

// Final database row combining input and enrichment
#[derive(Debug, Serialize, Deserialize, Row, Clone)]
pub struct MetricRow {
    // Fields from MetricInput
    pub time: u64,
    pub step: u64,
    #[serde(rename = "logGroup")]
    pub log_group: String,
    #[serde(rename = "logName")]
    pub log_name: LogName,
    pub value: f64,

    // Fields from MetricEnrichment
    #[serde(rename = "tenantId")]
    pub tenant_id: String,
    #[serde(rename = "runId")]
    pub run_id: u64,
    #[serde(rename = "projectName")]
    pub project_name: String,
}

impl DatabaseRow<MetricInput, MetricEnrichment> for MetricRow {
    fn from(input: MetricInput, enrichment: MetricEnrichment) -> Result<Self, AppError> {
        input.validate()?;

        // Take the first metric or return an error if empty
        let (log_name, value) = input.data.into_iter().next().ok_or_else(|| {
            AppError::new(
                ErrorCode::InvalidMetricFormat,
                "'data' field cannot be empty".to_string(),
            )
        })?;

        Ok(Self {
            time: input.time,
            step: input.step,
            log_group: log_group_from_log_name(&log_name),
            log_name,
            value,
            tenant_id: enrichment.tenant_id,
            run_id: enrichment.run_id,
            project_name: enrichment.project_name,
        })
    }

    fn table_name() -> &'static str {
        METRICS_TABLE_NAME
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::sanitize_json_non_finite_floats;

    /// Helper: sanitize input bytes then parse with simd_json
    fn parse_metric_input(json: &[u8]) -> MetricInput {
        let mut sanitized = sanitize_json_non_finite_floats(json);
        simd_json::from_slice::<MetricInput>(&mut sanitized)
            .expect("should parse successfully after sanitization")
    }

    #[test]
    fn test_normal_metrics_parse() {
        let input = br#"{"time": 100, "step": 1, "data": {"loss": 0.5, "acc": 0.95}}"#;
        let metric = parse_metric_input(input);
        assert_eq!(metric.time, 100);
        assert_eq!(metric.step, 1);
        assert_eq!(metric.data.len(), 2);
        assert_eq!(metric.data["loss"], 0.5);
        assert_eq!(metric.data["acc"], 0.95);
    }

    #[test]
    fn test_nan_values_preserved() {
        let input = br#"{"time": 100, "step": 1, "data": {"loss": NaN, "acc": 0.95}}"#;
        let metric = parse_metric_input(input);
        assert_eq!(metric.data.len(), 2);
        assert_eq!(metric.data["acc"], 0.95);
        assert!(metric.data["loss"].is_nan());
    }

    #[test]
    fn test_infinity_values_preserved() {
        let input = br#"{"time": 100, "step": 1, "data": {"grad_norm": Infinity, "loss": 0.5}}"#;
        let metric = parse_metric_input(input);
        assert_eq!(metric.data.len(), 2);
        assert_eq!(metric.data["loss"], 0.5);
        assert_eq!(metric.data["grad_norm"], f64::INFINITY);
    }

    #[test]
    fn test_negative_infinity_values_preserved() {
        let input = br#"{"time": 100, "step": 1, "data": {"min_val": -Infinity, "loss": 0.5}}"#;
        let metric = parse_metric_input(input);
        assert_eq!(metric.data.len(), 2);
        assert_eq!(metric.data["loss"], 0.5);
        assert_eq!(metric.data["min_val"], f64::NEG_INFINITY);
    }

    #[test]
    fn test_all_non_finite_preserved() {
        let input = br#"{"time": 100, "step": 1, "data": {"a": NaN, "b": Infinity, "c": -Infinity}}"#;
        let metric = parse_metric_input(input);
        assert_eq!(metric.data.len(), 3);
        assert!(metric.data["a"].is_nan());
        assert_eq!(metric.data["b"], f64::INFINITY);
        assert_eq!(metric.data["c"], f64::NEG_INFINITY);
        assert!(metric.validate().is_ok());
    }

    #[test]
    fn test_mixed_valid_and_non_finite() {
        let input = br#"{"time": 100, "step": 42, "data": {"training/loss": 0.123, "training/gradient/norm": Infinity, "training/data/min": -Infinity, "training/acc": 0.99, "training/nan_metric": NaN}}"#;
        let metric = parse_metric_input(input);
        assert_eq!(metric.data.len(), 5);
        assert_eq!(metric.data["training/loss"], 0.123);
        assert_eq!(metric.data["training/acc"], 0.99);
        assert_eq!(metric.data["training/gradient/norm"], f64::INFINITY);
        assert_eq!(metric.data["training/data/min"], f64::NEG_INFINITY);
        assert!(metric.data["training/nan_metric"].is_nan());
    }

    #[test]
    fn test_validate_empty_key() {
        let input = br#"{"time": 100, "step": 1, "data": {"": 0.5}}"#;
        let mut sanitized = sanitize_json_non_finite_floats(input);
        let metric = simd_json::from_slice::<MetricInput>(&mut sanitized).unwrap();
        assert!(metric.validate().is_err());
    }

    #[test]
    fn test_validate_empty_data() {
        // Empty data should error
        let input = br#"{"time": 100, "step": 1, "data": {}}"#;
        let mut sanitized = sanitize_json_non_finite_floats(input);
        let metric = simd_json::from_slice::<MetricInput>(&mut sanitized).unwrap();
        assert!(metric.validate().is_err());
    }

    #[test]
    fn test_into_rows_preserves_non_finite() {
        let input = br#"{"time": 100, "step": 1, "data": {"loss": 0.5, "grad": Infinity}}"#;
        let metric = parse_metric_input(input);
        let enrichment = MetricEnrichment {
            tenant_id: "test-tenant".to_string(),
            run_id: 1,
            project_name: "test-project".to_string(),
        };
        let rows = metric.into_rows(enrichment).unwrap();
        // Both finite and non-finite values are preserved
        assert_eq!(rows.len(), 2);
        let loss_row = rows.iter().find(|r| r.log_name == "loss").unwrap();
        let grad_row = rows.iter().find(|r| r.log_name == "grad").unwrap();
        assert_eq!(loss_row.value, 0.5);
        assert_eq!(grad_row.value, f64::INFINITY);
    }

    #[test]
    fn test_into_rows_preserves_nan() {
        let input = br#"{"time": 100, "step": 1, "data": {"a": NaN, "b": 1.0}}"#;
        let metric = parse_metric_input(input);
        let enrichment = MetricEnrichment {
            tenant_id: "test-tenant".to_string(),
            run_id: 1,
            project_name: "test-project".to_string(),
        };
        let rows = metric.into_rows(enrichment).unwrap();
        // Both NaN and finite values are preserved
        assert_eq!(rows.len(), 2);
        let a_row = rows.iter().find(|r| r.log_name == "a").unwrap();
        let b_row = rows.iter().find(|r| r.log_name == "b").unwrap();
        assert!(a_row.value.is_nan());
        assert_eq!(b_row.value, 1.0);
    }

    #[test]
    fn test_into_rows_all_non_finite_preserved() {
        let input = br#"{"time": 100, "step": 1, "data": {"a": NaN, "b": Infinity, "c": -Infinity}}"#;
        let metric = parse_metric_input(input);
        let enrichment = MetricEnrichment {
            tenant_id: "test-tenant".to_string(),
            run_id: 1,
            project_name: "test-project".to_string(),
        };
        let rows = metric.into_rows(enrichment).unwrap();
        // All non-finite values are preserved (stored in ClickHouse Float64)
        assert_eq!(rows.len(), 3);
    }
}
