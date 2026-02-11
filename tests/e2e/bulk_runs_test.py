"""
Bulk run creation test for pluto platform.

Creates many runs in a single project with:
- 20 shared config keys across all runs
- 1 unique config key per run (configkey<run_number>)
- Varied metrics with slight per-run variations
- Tags for grouping runs into categories

Each run uses a fresh Settings object to avoid SDK state leaking between
init()/finish() cycles (pluto mutates _op_id on the settings object).

Usage:
    # Against local Docker setup
    TEST_LOCAL=true python tests/e2e/bulk_runs_test.py

    # Against dev environment
    python tests/e2e/bulk_runs_test.py

    # Customize run count
    NUM_RUNS=100 python tests/e2e/bulk_runs_test.py
"""

import math
import os
import random
import subprocess
import time
from pathlib import Path


NUM_RUNS = int(os.getenv("NUM_RUNS", "10"))
PROJECT_NAME = os.getenv("PROJECT_NAME", "200-bulk-test")
EPOCHS_PER_RUN = int(os.getenv("EPOCHS_PER_RUN", "20"))

# Shared config keys present on every run
SHARED_CONFIG = {
    "optimizer": "adam",
    "scheduler": "cosine",
    "weight_decay": 0.01,
    "warmup_steps": 500,
    "max_grad_norm": 1.0,
    "seed": 42,
    "precision": "bf16",
    "gradient_accumulation_steps": 4,
    "num_workers": 8,
    "pin_memory": True,
    "dataset": "openwebtext",
    "tokenizer": "gpt2",
    "vocab_size": 50257,
    "max_seq_length": 1024,
    "eval_interval": 500,
    "save_interval": 1000,
    "log_interval": 10,
    "distributed_backend": "nccl",
    "compile_model": True,
    "flash_attention": True,
}

# Tag pools for variety
ARCHITECTURE_TAGS = ["transformer", "mamba", "rwkv", "retnet", "hyena"]
SIZE_TAGS = ["small", "medium", "large", "xl"]
EXPERIMENT_TAGS = ["baseline", "ablation", "sweep", "final", "debug"]
DATASET_TAGS = ["openwebtext", "c4", "pile", "redpajama", "slimpajama"]


def get_commit_hash() -> str:
    resolved = Path(__file__).resolve()
    repo_root = resolved.parents[2] if len(resolved.parents) > 2 else resolved.parent
    try:
        result = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(repo_root),
        )
        return result.decode().strip()
    except Exception:
        return "unknown"


def build_config(run_number: int) -> dict:
    """Build config for a specific run with shared keys + one unique key."""
    rng = random.Random(run_number)

    config = dict(SHARED_CONFIG)

    # Per-run hyperparameter variations
    config["learning_rate"] = rng.choice([1e-4, 3e-4, 5e-4, 1e-3, 3e-3])
    config["batch_size"] = rng.choice([8, 16, 32, 64, 128])
    config["num_layers"] = rng.choice([6, 12, 24, 36, 48])
    config["hidden_dim"] = rng.choice([256, 512, 768, 1024, 2048])
    config["num_heads"] = rng.choice([4, 8, 12, 16, 32])
    config["dropout"] = round(rng.uniform(0.0, 0.3), 2)
    config["epochs"] = EPOCHS_PER_RUN

    # Unique config key for this run
    config[f"configkey{run_number}"] = f"unique_value_for_run_{run_number}"

    return config


def build_tags(run_number: int) -> list[str]:
    """Assign 2-3 tags to a run for categorical grouping."""
    rng = random.Random(run_number)
    tags = [
        rng.choice(ARCHITECTURE_TAGS),
        rng.choice(SIZE_TAGS),
    ]
    if rng.random() < 0.6:
        tags.append(rng.choice(EXPERIMENT_TAGS))
    if rng.random() < 0.3:
        tags.append(rng.choice(DATASET_TAGS))
    return tags


def simulate_metrics(run_number: int, epochs: int) -> list[dict]:
    """Generate per-epoch metrics with slight per-run variation."""
    rng = random.Random(run_number)

    base_loss = rng.uniform(2.0, 5.0)
    convergence_rate = rng.uniform(0.05, 0.2)
    noise_scale = rng.uniform(0.01, 0.08)
    final_accuracy = rng.uniform(0.60, 0.95)

    metrics_list = []
    for epoch in range(epochs):
        t = epoch / max(epochs - 1, 1)

        train_loss = base_loss * math.exp(-convergence_rate * epoch) + rng.gauss(0, noise_scale)
        val_loss = train_loss * rng.uniform(1.0, 1.15) + rng.gauss(0, noise_scale * 0.5)
        accuracy = final_accuracy * (1 - math.exp(-3 * t)) + rng.gauss(0, 0.01)
        perplexity = math.exp(val_loss)
        lr_current = 1e-3 * (0.5 * (1 + math.cos(math.pi * t)))

        metrics_list.append({
            "train/loss": round(max(train_loss, 0.01), 4),
            "val/loss": round(max(val_loss, 0.01), 4),
            "val/accuracy": round(min(max(accuracy, 0.0), 1.0), 4),
            "val/perplexity": round(max(perplexity, 1.0), 2),
            "train/lr": round(lr_current, 8),
            "train/grad_norm": round(rng.uniform(0.1, 2.0), 4),
            "train/throughput_tokens_per_sec": round(rng.uniform(10000, 80000), 0),
            "system/gpu_memory_gb": round(rng.uniform(10, 40), 1),
            "system/gpu_utilization": round(rng.uniform(0.7, 1.0), 2),
            "epoch": epoch,
        })

    return metrics_list


def make_settings():
    """Create a fresh Settings object each time (pluto mutates it during init)."""
    import pluto

    settings = pluto.Settings()
    if os.getenv("TEST_LOCAL", "").lower() in ("true", "1", "yes"):
        settings.update({
            "url_app": "http://localhost:3000",
            "url_api": "http://localhost:3001",
            "url_ingest": "http://localhost:3003",
            "url_py": "http://localhost:3004",
        })
    else:
        settings.update({
            "url_app": "https://pluto-dev.trainy.ai",
            "url_api": "https://pluto-api-dev.trainy.ai",
            "url_ingest": "https://pluto-ingest-dev.trainy.ai",
            "url_py": "https://pluto-py-dev.trainy.ai",
        })
    return settings


def create_run(run_number: int, project: str, commit_hash: str, epochs: int) -> str:
    """Create a single run with config, tags, and metrics. Returns run name."""
    import pluto

    config = build_config(run_number)
    config["epochs"] = epochs
    tags = build_tags(run_number)
    run_name = f"bulk-{run_number:04d}-{commit_hash}"

    # Fresh settings each time — pluto mutates _op_id on the settings object
    settings = make_settings()

    run = pluto.init(
        project=project,
        name=run_name,
        config=config,
        tags=tags,
        settings=settings,
    )

    metrics_list = simulate_metrics(run_number, epochs)
    for metrics in metrics_list:
        run.log(metrics)

    run.finish()
    return run_name


def main():
    commit_hash = get_commit_hash()

    print(f"Bulk run creation test")
    print(f"  Project: {PROJECT_NAME}")
    print(f"  Runs: {NUM_RUNS}")
    print(f"  Epochs per run: {EPOCHS_PER_RUN}")
    print(f"  Shared config keys: {len(SHARED_CONFIG)}")
    print()

    start_time = time.time()
    completed = 0
    failed = 0

    for i in range(NUM_RUNS):
        try:
            name = create_run(i, PROJECT_NAME, commit_hash, EPOCHS_PER_RUN)
            completed += 1
            if completed % 10 == 0:
                elapsed = time.time() - start_time
                rate = completed / elapsed
                print(f"  [{completed}/{NUM_RUNS}] {rate:.1f} runs/s - last: {name}")
        except Exception as e:
            failed += 1
            print(f"  FAILED run {i}: {e}")

    elapsed = time.time() - start_time
    print()
    print(f"Done in {elapsed:.1f}s")
    print(f"  Completed: {completed}")
    print(f"  Failed: {failed}")
    if elapsed > 0:
        print(f"  Rate: {completed / elapsed:.1f} runs/s")


if __name__ == "__main__":
    main()
