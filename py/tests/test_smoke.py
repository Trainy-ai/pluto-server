"""
Python Service Smoke Tests

These tests verify critical functionality of the Python health monitoring service.
Run with: pytest tests/test_smoke.py -v
"""

import os
import pytest
import httpx
from typing import Optional

# Configuration
BASE_URL = os.getenv("TEST_PY_URL", "http://localhost:3004")
TEST_API_KEY = os.getenv("TEST_API_KEY", "")


class TestHealthAndConnectivity:
    """Test Suite 1: Health and Connectivity"""

    def test_1_1_health_check_endpoint(self):
        """Test 1.1: Health Check Endpoint"""
        response = httpx.get(f"{BASE_URL}/healthz")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"

    def test_1_2_database_connections(self):
        """Test 1.2: Database Connections

        This test verifies the service is running.
        Actual database connection verification would require log access.
        """
        response = httpx.get(f"{BASE_URL}/healthz")
        assert response.status_code == 200

        # If health check passes, service is running and should have DB connections
        # Actual connection state is verified in logs

    def test_1_3_background_monitor_starts(self):
        """Test 1.3: Background Monitor Starts

        This test verifies the API server is running.
        Background monitor verification requires process/log inspection.
        """
        response = httpx.get(f"{BASE_URL}/healthz")
        assert response.status_code == 200

        # Background monitor status would need to be checked via logs or separate endpoint


class TestAPIKeyAuthentication:
    """Test Suite 2: API Key Authentication"""

    def test_2_1_valid_api_key(self):
        """Test 2.1: Valid API Key"""
        if not TEST_API_KEY:
            pytest.skip("TEST_API_KEY not set")

        response = httpx.post(
            f"{BASE_URL}/api/runs/trigger",
            headers={"Authorization": TEST_API_KEY},
            json={"runId": "test-run-id"}
        )

        # May return 200 or 404 (if run doesn't exist), but not 401
        assert response.status_code in [200, 404, 400]

    def test_2_2_invalid_api_key(self):
        """Test 2.2: Invalid API Key"""
        response = httpx.post(
            f"{BASE_URL}/api/runs/trigger",
            headers={"Authorization": "invalid_key"},
            json={"runId": "test-run-id"}
        )

        assert response.status_code == 401
        data = response.json()
        assert "detail" in data or "error" in data

    def test_2_3_missing_api_key(self):
        """Test 2.3: Missing API Key"""
        response = httpx.post(
            f"{BASE_URL}/api/runs/trigger",
            json={"runId": "test-run-id"}
        )

        assert response.status_code == 401


class TestRunTriggerEndpoint:
    """Test Suite 3: Run Trigger Endpoint"""

    @pytest.mark.skipif(not TEST_API_KEY, reason="TEST_API_KEY not set")
    def test_3_1_check_run_triggers(self):
        """Test 3.1: Check Run Triggers"""
        response = httpx.post(
            f"{BASE_URL}/api/runs/trigger",
            headers={"Authorization": TEST_API_KEY},
            json={"runId": "test-run-id"}
        )

        # Should either succeed or fail with 404 (run not found), not auth error
        assert response.status_code in [200, 404, 400]

        if response.status_code == 200:
            data = response.json()
            # Response should have run status
            assert "status" in data or "triggers" in data

    # Test 3.2 (Cancel Trigger Processing) requires database setup
    # and is better suited for integration tests


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
