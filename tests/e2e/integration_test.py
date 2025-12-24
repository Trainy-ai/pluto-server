"""
End-to-end integration test for mlop platform.

This test validates the full stack deployment by:
1. Configuring mlop to use local services
2. Initializing a run with configuration
3. Logging metrics over multiple epochs
4. Finishing the run successfully
"""

import time

import mlop


def main():
    # Configure mlop to use local self-hosted instance
    settings = mlop.Settings()
    settings.update({
        'url_app': 'http://localhost:3000',
        'url_api': 'http://localhost:3001',
        'url_ingest': 'http://localhost:3003',
        'url_py': 'http://localhost:3004'
    })

    print("Starting integration test...")
    print(f"Configured URLs:")
    print(f"  App: {settings.url_app}")
    print(f"  API: {settings.url_api}")
    print(f"  Ingest: {settings.url_ingest}")
    print(f"  Py: {settings.url_py}")

    # Test basic logging functionality
    config = {
        'lr': 0.001,
        'epochs': 10,
        'batch_size': 32,
        'test': 'ci-integration'
    }

    run = mlop.init(
        project='ci-integration-test',
        name='quick-test',
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
