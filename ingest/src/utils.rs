pub fn log_group_from_log_name<S: AsRef<str>>(input: S) -> String {
    let s = input.as_ref();
    match s.rfind('/') {
        Some(last_slash) => s[..last_slash].to_string(),
        None => "".to_string(),
    }
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
}
