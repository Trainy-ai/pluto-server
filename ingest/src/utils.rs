pub fn log_group_from_log_name<S: AsRef<str>>(input: S) -> String {
    let s = input.as_ref();
    match s.rfind('/') {
        Some(last_slash) => s[..last_slash].to_string(),
        None => "".to_string(),
    }
}

/// Sanitize JSON bytes by converting non-finite float literals (`NaN`, `Infinity`,
/// `-Infinity`) into quoted JSON strings (`"NaN"`, `"Infinity"`, `"-Infinity"`).
/// Only converts occurrences outside of JSON string values.
///
/// These bare literals are produced by Python's `json.dumps` with `allow_nan=True`
/// (the default) but are not valid JSON. By converting them to strings, downstream
/// parsers (e.g., simd-json) can tokenize the input, and a custom serde deserializer
/// can map them back to `f64::NAN`, `f64::INFINITY`, and `f64::NEG_INFINITY`.
pub fn sanitize_json_non_finite_floats(input: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(input.len() + 16); // small extra for added quotes
    let len = input.len();
    let mut i = 0;
    let mut in_string = false;

    while i < len {
        if in_string {
            if input[i] == b'\\' && i + 1 < len {
                // Escaped character inside string — push both bytes and skip
                output.push(input[i]);
                output.push(input[i + 1]);
                i += 2;
                continue;
            }
            if input[i] == b'"' {
                in_string = false;
            }
            output.push(input[i]);
            i += 1;
            continue;
        }

        if input[i] == b'"' {
            in_string = true;
            output.push(input[i]);
            i += 1;
            continue;
        }

        // Check for -Infinity (9 bytes) — must check before Infinity
        if input[i] == b'-' && i + 9 <= len && &input[i..i + 9] == b"-Infinity" {
            output.extend_from_slice(b"\"-Infinity\"");
            i += 9;
            continue;
        }

        // Check for Infinity (8 bytes)
        if input[i] == b'I' && i + 8 <= len && &input[i..i + 8] == b"Infinity" {
            output.extend_from_slice(b"\"Infinity\"");
            i += 8;
            continue;
        }

        // Check for NaN (3 bytes)
        if input[i] == b'N' && i + 3 <= len && &input[i..i + 3] == b"NaN" {
            output.extend_from_slice(b"\"NaN\"");
            i += 3;
            continue;
        }

        output.push(input[i]);
        i += 1;
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_group_from_log_name() {
        assert_eq!(log_group_from_log_name("a/b/c"), "a/b");
        assert_eq!(log_group_from_log_name("a/b/c/d/e"), "a/b/c/d");
    }

    #[test]
    fn test_log_group_from_log_name_empty() {
        assert_eq!(log_group_from_log_name(""), "");
    }

    #[test]
    fn test_no_log_group() {
        assert_eq!(log_group_from_log_name("test-metric"), "");
    }

    #[test]
    fn test_sanitize_nan() {
        let input = br#"{"data": {"loss": NaN, "acc": 0.95}}"#;
        let output = sanitize_json_non_finite_floats(input);
        assert_eq!(
            String::from_utf8(output).unwrap(),
            r#"{"data": {"loss": "NaN", "acc": 0.95}}"#
        );
    }

    #[test]
    fn test_sanitize_infinity() {
        let input = br#"{"data": {"grad_norm": Infinity}}"#;
        let output = sanitize_json_non_finite_floats(input);
        assert_eq!(
            String::from_utf8(output).unwrap(),
            r#"{"data": {"grad_norm": "Infinity"}}"#
        );
    }

    #[test]
    fn test_sanitize_negative_infinity() {
        let input = br#"{"data": {"min_val": -Infinity}}"#;
        let output = sanitize_json_non_finite_floats(input);
        assert_eq!(
            String::from_utf8(output).unwrap(),
            r#"{"data": {"min_val": "-Infinity"}}"#
        );
    }

    #[test]
    fn test_sanitize_mixed() {
        let input = br#"{"time": 123, "step": 1, "data": {"a": NaN, "b": Infinity, "c": -Infinity, "d": 1.5}}"#;
        let output = sanitize_json_non_finite_floats(input);
        assert_eq!(
            String::from_utf8(output).unwrap(),
            r#"{"time": 123, "step": 1, "data": {"a": "NaN", "b": "Infinity", "c": "-Infinity", "d": 1.5}}"#
        );
    }

    #[test]
    fn test_sanitize_preserves_strings() {
        // NaN/Infinity inside string values should NOT be replaced
        let input = br#"{"name": "NaN-metric", "desc": "Infinity is bad", "data": {"x": NaN}}"#;
        let output = sanitize_json_non_finite_floats(input);
        assert_eq!(
            String::from_utf8(output).unwrap(),
            r#"{"name": "NaN-metric", "desc": "Infinity is bad", "data": {"x": "NaN"}}"#
        );
    }

    #[test]
    fn test_sanitize_preserves_escaped_quotes() {
        // Escaped quotes inside strings should not break string tracking
        let input = br#"{"name": "has \"NaN\" inside", "data": {"x": NaN}}"#;
        let output = sanitize_json_non_finite_floats(input);
        assert_eq!(
            String::from_utf8(output).unwrap(),
            r#"{"name": "has \"NaN\" inside", "data": {"x": "NaN"}}"#
        );
    }

    #[test]
    fn test_sanitize_no_changes() {
        let input = br#"{"time": 123, "step": 1, "data": {"loss": 0.5}}"#;
        let output = sanitize_json_non_finite_floats(input);
        assert_eq!(output, input.to_vec());
    }

    #[test]
    fn test_sanitize_all_non_finite() {
        let input = br#"{"time": 123, "step": 1, "data": {"a": NaN, "b": Infinity}}"#;
        let output = sanitize_json_non_finite_floats(input);
        assert_eq!(
            String::from_utf8(output).unwrap(),
            r#"{"time": 123, "step": 1, "data": {"a": "NaN", "b": "Infinity"}}"#
        );
    }
}
