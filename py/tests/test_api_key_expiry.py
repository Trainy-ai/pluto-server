"""
Unit tests for is_api_key_expired (API key expiration check).

Regression coverage for the naive/aware datetime bug: ApiKey.expiresAt is
a naive TIMESTAMP column, so a value read from the DB is offset-naive.
The old code compared it directly against datetime.now(timezone.utc)
(offset-aware), which raises TypeError — turning every /api/runs/trigger
call from a client using an expiring API key into a 500.

Run with: pytest tests/test_api_key_expiry.py -vv
"""

from datetime import datetime, timezone

from python.server import is_api_key_expired


def test_none_expiry_never_expires():
    assert is_api_key_expired(None) is False


def test_does_not_raise_on_naive_input():
    # Direct regression guard. The old code did
    #   expiresAt < datetime.now(timezone.utc)
    # which raised TypeError when expiresAt was naive (as read from the
    # TIMESTAMP column). This must complete without raising.
    is_api_key_expired(datetime(2030, 1, 1, 0, 0, 0))


def test_naive_past_expiry_is_expired():
    # A naive datetime in the past — the exact production scenario.
    naive_past = datetime(2000, 1, 1, 0, 0, 0)
    assert naive_past.tzinfo is None
    assert is_api_key_expired(naive_past) is True


def test_naive_future_expiry_is_not_expired():
    naive_future = datetime(2099, 1, 1, 0, 0, 0)
    assert naive_future.tzinfo is None
    assert is_api_key_expired(naive_future) is False


def test_aware_past_expiry_is_expired():
    aware_past = datetime(2000, 1, 1, tzinfo=timezone.utc)
    assert is_api_key_expired(aware_past) is True


def test_aware_future_expiry_is_not_expired():
    aware_future = datetime(2099, 1, 1, tzinfo=timezone.utc)
    assert is_api_key_expired(aware_future) is False


def test_naive_and_aware_same_instant_agree():
    # A naive value (interpreted as UTC) and the equivalent aware value
    # must produce the same result — no dependence on how it was built.
    naive = datetime(2099, 6, 1, 12, 0, 0)
    aware = datetime(2099, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
    assert is_api_key_expired(naive) == is_api_key_expired(aware)
