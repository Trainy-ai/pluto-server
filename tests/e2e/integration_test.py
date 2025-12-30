"""
End-to-end integration test for mlop platform.

This test validates the full stack deployment by:
1. Configuring mlop to use local services
2. Initializing a run with configuration
3. Logging metrics over multiple epochs
4. Finishing the run successfully
"""

import subprocess
import time
from pathlib import Path

import mlop


def get_commit_hash() -> str:
    resolved = Path(__file__).resolve()
    repo_root = resolved.parents[2] if len(resolved.parents) > 2 else resolved.parent
    try:
        result = subprocess.check_output(
            ['git', 'rev-parse', '--short', 'HEAD'],
            cwd=str(repo_root),
        )
        return result.decode().strip()
    except Exception:
        return 'unknown'


def main():
    # Configure mlop to use local self-hosted instance
    settings = mlop.Settings()
    settings.update({
        'url_app': 'https://trakkur-dev.trainy.ai',
        'url_api': 'https://trakkur-api-dev.trainy.ai',
        'url_ingest': 'https://trakkur-ingest-dev.trainy.ai',
        'url_py': 'https://trakkur-py-dev.trainy.ai'
    })

    print("Starting integration test...")
    print(f"Configured URLs:")
    print(f"  App: {settings.url_app}")
    print(f"  API: {settings.url_api}")
    print(f"  Ingest: {settings.url_ingest}")
    print(f"  Py: {settings.url_py}")

    commit_hash = get_commit_hash()
    print(f"Using commit hash {commit_hash} for the run name...")

    # Test basic logging functionality
    config = {
        'lr': 0.001,
        'epochs': 10,
        'batch_size': 32,
        'test': f'test-ci-commit-{commit_hash}'
    }

    run = mlop.init(
        project='test-ci',
        name=f'integration-test-commit-{commit_hash}',
        config=config,
        settings=settings
    )

    print("Logging metrics...")
    for i in range(config['epochs']):
        metrics = {
            'val/loss': 1.0 / (i + 1),
            'val/accuracy': i * 0.1,
            'train/loss': 1.5 / (i + 1),
            'epoch': i
        }
        run.log(metrics)
        print(f"Epoch {i}: logged metrics {metrics}")
        time.sleep(0.1)

    print("Finishing run...")
    run.finish()

    print("Integration test completed successfully!")


if __name__ == '__main__':
    main()
