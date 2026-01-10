"""
End-to-end integration test for mlop platform.

This test validates the full stack deployment by:
1. Configuring mlop to use local services
2. Initializing a run with configuration
3. Logging metrics over multiple epochs
4. Finishing the run successfully
"""

import os
import subprocess
import time
from pathlib import Path

import mlop

try:
    from PIL import Image
    import numpy as np
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False


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


def create_colored_square(color: tuple[int, int, int], size: int = 50) -> "Image.Image":
    """Create a small colored square image.

    Args:
        color: RGB tuple (e.g., (255, 0, 0) for red)
        size: Size of the square in pixels

    Returns:
        PIL Image object
    """
    if not PIL_AVAILABLE:
        raise ImportError("PIL/Pillow is required to create images")

    # Create array filled with the color
    arr = np.zeros((size, size, 3), dtype=np.uint8)
    arr[:, :] = color

    return Image.fromarray(arr)


def main():
    # Configure mlop to use local self-hosted instance
    settings = mlop.Settings()
    # settings.update({
    #     'url_app': 'https://trakkur-dev.trainy.ai',
    #     'url_api': 'https://trakkur-api-dev.trainy.ai',
    #     'url_ingest': 'https://trakkur-ingest-dev.trainy.ai',
    #     'url_py': 'https://trakkur-py-dev.trainy.ai'
    # })
    settings.update({
        'url_app': 'http://localhost:3000',
        'url_api': 'http://localhost:3001',
        'url_ingest': 'http://localhost:3003',
        'url_py': 'http://localhost:3004',
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

    # Conditional: Log colored squares for image comparison testing
    if os.getenv('TEST_IMAGE_LOGGING', '').lower() in ('true', '1', 'yes'):
        if PIL_AVAILABLE:
            print("\nLogging colored squares for image comparison testing...")

            # Log colored squares at different steps
            colors_and_steps = [
                ("red", (255, 0, 0), 0),
                ("green", (0, 255, 0), 5),
                ("blue", (0, 0, 255), 10),
            ]
            for name, rgb, step in colors_and_steps:
                square = create_colored_square(rgb, size=50)
                run.log({"test/square": mlop.Image(square)}, step=step)
                print(f"  Step {step}: Logged {name} square")
        else:
            print("\nWarning: PIL/Pillow not available, skipping image logging")
    else:
        print("\nSkipping image logging (set TEST_IMAGE_LOGGING=true to enable)")

    print("\nFinishing run...")
    time.sleep(10000000)
    run.finish()

    print("Integration test completed successfully!")


if __name__ == '__main__':
    main()
