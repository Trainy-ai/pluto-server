# Development helpers for the Rust ingest service
# Requires: cargo, rustup component llvm-tools-preview, cargo-llvm-cov

.PHONY: test test-cov test-cov-html lint fmt check all

# Run all tests
test:
	cargo test

# Run tests with coverage report (text summary)
test-cov:
	cargo llvm-cov --lib

# Run tests with coverage report (HTML) — opens in browser
test-cov-html:
	cargo llvm-cov --lib --html --open

# Run tests with coverage report (LCOV) — for CI/tooling
test-cov-lcov:
	cargo llvm-cov --lib --lcov --output-path lcov.info

# Lint with clippy
lint:
	cargo clippy -- -D warnings

# Check formatting
fmt:
	cargo fmt --check

# Format code (auto-fix)
fmt-fix:
	cargo fmt

# Full pre-commit check: fmt + clippy + tests with coverage
check: fmt lint test-cov

# Same as check
all: check

# Install coverage tooling
setup-coverage:
	rustup component add llvm-tools-preview
	cargo install cargo-llvm-cov
