"""
Seed script: creates 250 runs in project "test" with comprehensive data.

Each run has:
- Config: shared keys + unique keys + string/numeric/boolean mix
- 5 unique metrics per run (edge case values)
- 100 shared metrics across all runs
- train/loss, train/accuracy, train/f1 + test/ counterparts
- Random subset of: histograms, images, audio, video
- Random console logs: INFO (stdout) and ERROR (stderr)
- Edge case metric values: huge, tiny, negative, scientific notation, etc.

Usage:
    TEST_LOCAL=true PLUTO_API_TOKEN=mlpi_... python tests/e2e/seed_test_project.py
"""

import logging
import math
import os
import random
import sys
import time

import numpy as np
import pluto

try:
    from PIL import Image as PILImage

    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

NUM_RUNS = 250
PROJECT_NAME = "test"
EPOCHS_PER_RUN = 30

# ── 100 shared metric names ──
SHARED_METRICS = [
    # Core training metrics (6)
    "train/loss", "train/accuracy", "train/f1",
    "test/loss", "test/accuracy", "test/f1",
    # Extended train metrics (14)
    "train/precision", "train/recall", "train/auc", "train/mse",
    "train/mae", "train/rmse", "train/r2", "train/cross_entropy",
    "train/kl_divergence", "train/cosine_similarity", "train/hinge_loss",
    "train/huber_loss", "train/log_loss", "train/perplexity",
    # Extended test metrics (14)
    "test/precision", "test/recall", "test/auc", "test/mse",
    "test/mae", "test/rmse", "test/r2", "test/cross_entropy",
    "test/kl_divergence", "test/cosine_similarity", "test/hinge_loss",
    "test/huber_loss", "test/log_loss", "test/perplexity",
    # Learning rate and optimization (10)
    "optim/learning_rate", "optim/momentum", "optim/weight_decay_effective",
    "optim/grad_norm", "optim/grad_norm_clipped", "optim/param_norm",
    "optim/update_ratio", "optim/loss_scale", "optim/warmup_factor",
    "optim/lr_multiplier",
    # System metrics (10)
    "system/gpu_utilization", "system/gpu_memory_gb", "system/gpu_temp_celsius",
    "system/cpu_utilization", "system/ram_usage_gb", "system/disk_io_mbps",
    "system/network_io_mbps", "system/throughput_samples_sec",
    "system/batch_time_ms", "system/data_loading_ms",
    # Per-layer metrics (20)
    "layers/layer_0/weight_mean", "layers/layer_0/weight_std",
    "layers/layer_0/grad_mean", "layers/layer_0/grad_std",
    "layers/layer_1/weight_mean", "layers/layer_1/weight_std",
    "layers/layer_1/grad_mean", "layers/layer_1/grad_std",
    "layers/layer_2/weight_mean", "layers/layer_2/weight_std",
    "layers/layer_2/grad_mean", "layers/layer_2/grad_std",
    "layers/layer_3/weight_mean", "layers/layer_3/weight_std",
    "layers/layer_3/grad_mean", "layers/layer_3/grad_std",
    "layers/layer_4/weight_mean", "layers/layer_4/weight_std",
    "layers/layer_4/grad_mean", "layers/layer_4/grad_std",
    # Validation sub-metrics (10)
    "val/bleu", "val/rouge_1", "val/rouge_2", "val/rouge_l", "val/meteor",
    "val/cider", "val/spice", "val/wer", "val/cer", "val/ter",
    # Aggregate / summary (16)
    "summary/epoch", "summary/total_steps", "summary/total_samples",
    "summary/best_train_loss", "summary/best_test_loss", "summary/best_accuracy",
    "summary/ema_train_loss", "summary/ema_test_loss", "summary/running_avg_loss",
    "summary/loss_variance", "summary/convergence_rate", "summary/plateau_count",
    "summary/nan_count", "summary/inf_count", "summary/overflow_count",
    "summary/underflow_count",
]
assert len(SHARED_METRICS) == 100, f"Expected 100 shared metrics, got {len(SHARED_METRICS)}"

# ── Edge case value generators ──
EDGE_CASE_GENERATORS = [
    lambda rng: rng.uniform(1e12, 9.99e15),
    lambda rng: rng.uniform(-9.99e15, -1e12),
    lambda rng: rng.uniform(1e-15, 1e-10),
    lambda rng: rng.uniform(-1e-10, -1e-15),
    lambda rng: rng.uniform(0.0001, 0.0009),
    lambda rng: rng.uniform(0.00001, 0.00009),
    lambda rng: float(f"{rng.uniform(1, 9):.6e}"),
    lambda rng: float(f"{rng.uniform(1, 9):.2e}") * 1e-8,
    lambda rng: rng.choice([-0.0, 0.0]),
    lambda rng: rng.uniform(-1, 1) * 1e-20,
    lambda rng: rng.uniform(1, 9) * 10 ** rng.randint(6, 12),
    lambda rng: -(rng.uniform(1, 9) * 10 ** rng.randint(6, 12)),
    lambda rng: rng.uniform(-0.5, 0.5),
    lambda rng: rng.randint(-1000, 1000) * 1.0,
    lambda rng: rng.uniform(99999.0, 100001.0),
    lambda rng: math.pi * 10 ** rng.randint(-5, 5),
    lambda rng: math.e * 10 ** rng.randint(-5, 5),
    lambda rng: 1.0 / rng.randint(3, 9999),
    lambda rng: rng.uniform(0.99999, 1.00001),
    lambda rng: rng.uniform(-0.00001, 0.00001),
]

# Tag pools
ARCH_TAGS = ["resnet", "transformer", "vit", "mlp-mixer", "convnext", "efficientnet", "bert", "gpt"]
SIZE_TAGS = ["tiny", "small", "base", "large", "xl", "xxl"]
TASK_TAGS = ["classification", "detection", "segmentation", "generation", "translation", "summarization"]
STATUS_TAGS = ["baseline", "ablation", "sweep", "final", "debug", "experiment"]
DATASET_TAGS = ["imagenet", "coco", "cifar10", "cifar100", "wikitext", "openwebtext", "c4"]

# Shared config keys (present on every run)
BASE_CONFIG = {
    # String configs
    "optimizer": "adamw",
    "scheduler": "cosine_annealing",
    "precision": "bf16",
    "distributed_backend": "nccl",
    "tokenizer": "gpt2",
    "loss_function": "cross_entropy",
    "activation": "gelu",
    "normalization": "layer_norm",
    "positional_encoding": "rotary",
    "attention_type": "multi_head",
    # Numeric configs
    "weight_decay": 0.01,
    "warmup_steps": 500,
    "max_grad_norm": 1.0,
    "gradient_accumulation_steps": 4,
    "num_workers": 8,
    "max_seq_length": 1024,
    "vocab_size": 50257,
    "eval_interval": 500,
    "save_interval": 1000,
    "log_interval": 10,
    # Boolean configs
    "pin_memory": True,
    "compile_model": True,
    "flash_attention": True,
    "gradient_checkpointing": False,
    "mixed_precision": True,
}

# Console log templates
INFO_TEMPLATES = [
    "[Epoch {epoch}/{total}] train_loss={tl:.4f} val_loss={vl:.4f} acc={acc:.3f}",
    "  LR: {lr:.6f} | Grad norm: {gn:.3f} | Batch time: {bt:.1f}ms",
    "  GPU mem: {gpu_mem:.1f}GB | Util: {gpu_util:.0%} | Throughput: {tp:.0f} samples/s",
    "Saving checkpoint at epoch {epoch}...",
    "Checkpoint saved successfully",
    "Loading data batch {batch}... ({samples} samples)",
    "Starting evaluation on validation set...",
    "Evaluation complete: accuracy={acc:.4f} f1={f1:.4f}",
    "Model parameters: {params:,} total, {trainable:,} trainable",
    "Training resumed from epoch {epoch}",
    "Data augmentation: {aug} applied",
    "Batch {batch}: loss={loss:.4f} (rolling avg: {avg:.4f})",
    "Memory allocated: {alloc:.1f}GB / {total_mem:.1f}GB ({pct:.0%})",
    "Warmup phase: step {step}/{warmup_steps}, lr={lr:.8f}",
    "New best validation loss: {vl:.6f} (previous: {prev:.6f})",
]

ERROR_TEMPLATES = [
    "CUDA out of memory. Tried to allocate {size}MB. GPU {gpu} has {free}MB free",
    "NaN detected in gradients at epoch {epoch}, step {step}. Skipping batch.",
    "WARNING: Loss spike detected: {loss:.4f} (expected < {threshold:.4f})",
    "Connection timeout while saving checkpoint to remote storage",
    "Gradient overflow detected in layer {layer}. Reducing loss scale.",
    "Data loading error: corrupted sample at index {idx}. Skipping.",
    "RuntimeError: Expected tensor of size {expected} but got {actual}",
    "UserWarning: lr_scheduler.step() called before optimizer.step()",
    "Numerical instability in attention scores. Applying clipping.",
    "Disk space warning: only {free}GB remaining on {mount}",
    "Process {pid} received SIGTERM. Initiating graceful shutdown.",
    "Failed to sync metrics to remote server. Retrying in {retry}s.",
    "Memory fragmentation detected. Consider reducing batch size.",
    "Validation metric decreased for {patience} consecutive epochs.",
    "Tensor shape mismatch in residual connection: {shape1} vs {shape2}",
]


def make_settings():
    settings = pluto.Settings()
    if os.getenv("TEST_LOCAL", "").lower() in ("true", "1", "yes"):
        settings.update({
            "url_app": "http://localhost:3000",
            "url_api": "http://localhost:3001",
            "url_ingest": "http://localhost:3003",
            "url_py": "http://localhost:3004",
        })
    # Set auth AFTER update() since update() may reset fields
    api_token = os.getenv("PLUTO_API_TOKEN", "")
    if api_token:
        settings._auth = api_token
    return settings


def build_config(run_idx: int, rng: random.Random) -> dict:
    config = dict(BASE_CONFIG)

    # Per-run numeric hyperparameters
    config["learning_rate"] = rng.choice([1e-5, 3e-5, 1e-4, 3e-4, 5e-4, 1e-3, 3e-3])
    config["batch_size"] = rng.choice([4, 8, 16, 32, 64, 128, 256])
    config["num_layers"] = rng.choice([2, 4, 6, 8, 12, 24, 36, 48])
    config["hidden_dim"] = rng.choice([64, 128, 256, 512, 768, 1024, 2048, 4096])
    config["num_heads"] = rng.choice([1, 2, 4, 8, 12, 16, 32])
    config["dropout"] = round(rng.uniform(0.0, 0.5), 3)
    config["epochs"] = EPOCHS_PER_RUN
    config["seed"] = rng.randint(0, 99999)

    # Per-run string configs
    config["model_type"] = rng.choice(ARCH_TAGS)
    config["dataset"] = rng.choice(DATASET_TAGS)
    config["run_name"] = f"experiment-{run_idx:04d}"
    config["description"] = rng.choice([
        "Baseline experiment with default hyperparameters",
        "Ablation study on learning rate",
        "Sweep over batch sizes and layer counts",
        "Final training run with best config",
        "Debug run for loss debugging",
        "Architecture comparison experiment",
        "Data augmentation ablation",
        "Optimizer comparison study",
        "Regularization strength sweep",
        "Distributed training test",
    ])
    config["notes"] = rng.choice([
        "Running on 4xA100 GPUs",
        "Using mixed precision training",
        "Reduced dataset for quick iteration",
        "Full training run - expect 12h",
        "Testing new data pipeline",
        "",  # some runs have empty notes
    ])
    config["environment"] = rng.choice(["local", "cloud-gcp", "cloud-aws", "slurm-cluster", "docker"])
    config["gpu_type"] = rng.choice(["A100-80GB", "A100-40GB", "V100-32GB", "H100-80GB", "RTX4090", "L40S"])

    # Unique config key per run
    config[f"run_{run_idx}_unique_param"] = f"value_{run_idx}"

    # Some runs have extra nested-like string config
    if rng.random() < 0.3:
        config["wandb_project"] = f"project-{rng.choice(['alpha', 'beta', 'gamma', 'delta'])}"
        config["wandb_entity"] = "ml-team"
    if rng.random() < 0.2:
        config["resume_from"] = f"checkpoint-epoch-{rng.randint(1, 50)}.pt"

    return config


def build_tags(rng: random.Random) -> list:
    tags = [rng.choice(ARCH_TAGS), rng.choice(SIZE_TAGS)]
    if rng.random() < 0.7:
        tags.append(rng.choice(TASK_TAGS))
    if rng.random() < 0.5:
        tags.append(rng.choice(STATUS_TAGS))
    if rng.random() < 0.3:
        tags.append(rng.choice(DATASET_TAGS))
    return tags


def pick_edge_value(rng: random.Random) -> float:
    gen = rng.choice(EDGE_CASE_GENERATORS)
    return gen(rng)


def generate_shared_metrics(epoch: int, rng: random.Random, run_params: dict) -> dict:
    """Generate values for all 100 shared metrics at a given epoch."""
    t = epoch / max(EPOCHS_PER_RUN - 1, 1)
    base_lr = run_params["lr"]
    base_loss = run_params["base_loss"]
    conv_rate = run_params["conv_rate"]
    noise = run_params["noise"]
    final_acc = run_params["final_acc"]

    tl = max(base_loss * math.exp(-conv_rate * epoch) + rng.gauss(0, noise), 0.001)
    vl = max(tl * rng.uniform(1.0, 1.2) + rng.gauss(0, noise * 0.5), 0.001)
    acc = min(max(final_acc * (1 - math.exp(-3 * t)) + rng.gauss(0, 0.01), 0.0), 1.0)
    lr_now = base_lr * (0.5 * (1 + math.cos(math.pi * t)))

    m = {}
    m["train/loss"] = round(tl, 6)
    m["train/accuracy"] = round(min(acc + rng.gauss(0, 0.005), 1.0), 6)
    m["train/f1"] = round(min(acc * 0.98 + rng.gauss(0, 0.008), 1.0), 6)
    m["test/loss"] = round(vl, 6)
    m["test/accuracy"] = round(min(acc * 0.97 + rng.gauss(0, 0.01), 1.0), 6)
    m["test/f1"] = round(min(acc * 0.95 + rng.gauss(0, 0.01), 1.0), 6)
    m["train/precision"] = round(min(acc * 0.96 + rng.gauss(0, 0.01), 1.0), 6)
    m["train/recall"] = round(min(acc * 0.94 + rng.gauss(0, 0.01), 1.0), 6)
    m["train/auc"] = round(min(acc * 0.99 + rng.gauss(0, 0.005), 1.0), 6)
    m["train/mse"] = round(tl ** 2 + rng.gauss(0, 0.001), 8)
    m["train/mae"] = round(abs(tl) + rng.gauss(0, 0.005), 6)
    m["train/rmse"] = round(math.sqrt(abs(tl ** 2 + rng.gauss(0, 0.001))), 6)
    m["train/r2"] = round(min(1 - tl / base_loss + rng.gauss(0, 0.01), 1.0), 6)
    m["train/cross_entropy"] = round(tl * 1.1 + rng.gauss(0, noise), 6)
    m["train/kl_divergence"] = round(abs(tl * 0.3 + rng.gauss(0, 0.01)), 6)
    m["train/cosine_similarity"] = round(min(acc * 0.99, 1.0), 6)
    m["train/hinge_loss"] = round(max(1 - acc + rng.gauss(0, 0.02), 0), 6)
    m["train/huber_loss"] = round(tl * 0.8 + rng.gauss(0, noise * 0.5), 6)
    m["train/log_loss"] = round(max(-math.log(max(acc, 0.001)) + rng.gauss(0, 0.01), 0.001), 6)
    m["train/perplexity"] = round(math.exp(min(tl, 10)), 4)
    m["test/precision"] = round(min(acc * 0.93 + rng.gauss(0, 0.01), 1.0), 6)
    m["test/recall"] = round(min(acc * 0.91 + rng.gauss(0, 0.01), 1.0), 6)
    m["test/auc"] = round(min(acc * 0.97 + rng.gauss(0, 0.005), 1.0), 6)
    m["test/mse"] = round(vl ** 2 + rng.gauss(0, 0.001), 8)
    m["test/mae"] = round(abs(vl) + rng.gauss(0, 0.005), 6)
    m["test/rmse"] = round(math.sqrt(abs(vl ** 2 + rng.gauss(0, 0.001))), 6)
    m["test/r2"] = round(min(1 - vl / (base_loss * 1.2) + rng.gauss(0, 0.01), 1.0), 6)
    m["test/cross_entropy"] = round(vl * 1.1 + rng.gauss(0, noise), 6)
    m["test/kl_divergence"] = round(abs(vl * 0.3 + rng.gauss(0, 0.01)), 6)
    m["test/cosine_similarity"] = round(min(acc * 0.97, 1.0), 6)
    m["test/hinge_loss"] = round(max(1 - acc * 0.97 + rng.gauss(0, 0.02), 0), 6)
    m["test/huber_loss"] = round(vl * 0.8 + rng.gauss(0, noise * 0.5), 6)
    m["test/log_loss"] = round(max(-math.log(max(acc * 0.97, 0.001)) + rng.gauss(0, 0.01), 0.001), 6)
    m["test/perplexity"] = round(math.exp(min(vl, 10)), 4)
    m["optim/learning_rate"] = lr_now
    m["optim/momentum"] = 0.9 + rng.gauss(0, 0.001)
    m["optim/weight_decay_effective"] = 0.01 * (1 - t * 0.1)
    m["optim/grad_norm"] = round(max(2.0 * math.exp(-2 * t) + rng.gauss(0, 0.1), 0.001), 6)
    m["optim/grad_norm_clipped"] = round(min(m["optim/grad_norm"], 1.0), 6)
    m["optim/param_norm"] = round(50 + 10 * t + rng.gauss(0, 1), 4)
    m["optim/update_ratio"] = round(abs(rng.gauss(0.001, 0.0005)), 8)
    m["optim/loss_scale"] = 2.0 ** rng.randint(10, 16)
    m["optim/warmup_factor"] = min(1.0, (epoch + 1) / 5)
    m["optim/lr_multiplier"] = round(0.5 * (1 + math.cos(math.pi * t)), 6)
    m["system/gpu_utilization"] = round(rng.uniform(0.7, 1.0), 3)
    m["system/gpu_memory_gb"] = round(rng.uniform(8, 40), 2)
    m["system/gpu_temp_celsius"] = round(rng.uniform(55, 85), 1)
    m["system/cpu_utilization"] = round(rng.uniform(0.2, 0.9), 3)
    m["system/ram_usage_gb"] = round(rng.uniform(4, 64), 2)
    m["system/disk_io_mbps"] = round(rng.uniform(10, 500), 1)
    m["system/network_io_mbps"] = round(rng.uniform(1, 100), 1)
    m["system/throughput_samples_sec"] = round(rng.uniform(500, 80000), 1)
    m["system/batch_time_ms"] = round(rng.uniform(10, 2000), 2)
    m["system/data_loading_ms"] = round(rng.uniform(1, 200), 2)
    for layer in range(5):
        scale = 0.5 * math.exp(-t * 0.5)
        m[f"layers/layer_{layer}/weight_mean"] = round(rng.gauss(0, 0.01), 8)
        m[f"layers/layer_{layer}/weight_std"] = round(abs(rng.gauss(scale, 0.01)), 8)
        m[f"layers/layer_{layer}/grad_mean"] = round(rng.gauss(0, 0.001 * math.exp(-t)), 8)
        m[f"layers/layer_{layer}/grad_std"] = round(abs(rng.gauss(0.01 * math.exp(-t), 0.001)), 8)
    m["val/bleu"] = round(rng.uniform(0, 1) * acc, 4)
    m["val/rouge_1"] = round(rng.uniform(0.3, 0.9) * acc, 4)
    m["val/rouge_2"] = round(rng.uniform(0.1, 0.6) * acc, 4)
    m["val/rouge_l"] = round(rng.uniform(0.2, 0.8) * acc, 4)
    m["val/meteor"] = round(rng.uniform(0.2, 0.7) * acc, 4)
    m["val/cider"] = round(rng.uniform(0, 2) * acc, 4)
    m["val/spice"] = round(rng.uniform(0, 0.5) * acc, 4)
    m["val/wer"] = round(max(1 - acc + rng.gauss(0, 0.05), 0.01), 4)
    m["val/cer"] = round(max(1 - acc * 1.1 + rng.gauss(0, 0.05), 0.01), 4)
    m["val/ter"] = round(max(1 - acc * 0.9 + rng.gauss(0, 0.05), 0.01), 4)
    m["summary/epoch"] = epoch
    m["summary/total_steps"] = (epoch + 1) * 100
    m["summary/total_samples"] = (epoch + 1) * run_params["batch_size"] * 100
    m["summary/best_train_loss"] = round(min(tl, run_params.get("best_tl", tl)), 6)
    m["summary/best_test_loss"] = round(min(vl, run_params.get("best_vl", vl)), 6)
    m["summary/best_accuracy"] = round(max(acc, run_params.get("best_acc", acc)), 6)
    m["summary/ema_train_loss"] = round(tl * 0.1 + run_params.get("ema_tl", tl) * 0.9, 6)
    m["summary/ema_test_loss"] = round(vl * 0.1 + run_params.get("ema_vl", vl) * 0.9, 6)
    m["summary/running_avg_loss"] = round((tl + vl) / 2, 6)
    m["summary/loss_variance"] = round(abs(tl - vl) ** 2, 8)
    m["summary/convergence_rate"] = round(conv_rate, 6)
    m["summary/plateau_count"] = rng.randint(0, 3)
    m["summary/nan_count"] = 0
    m["summary/inf_count"] = 0
    m["summary/overflow_count"] = 0
    m["summary/underflow_count"] = 0

    run_params["best_tl"] = min(tl, run_params.get("best_tl", 999))
    run_params["best_vl"] = min(vl, run_params.get("best_vl", 999))
    run_params["best_acc"] = max(acc, run_params.get("best_acc", 0))
    run_params["ema_tl"] = m["summary/ema_train_loss"]
    run_params["ema_vl"] = m["summary/ema_test_loss"]

    # Store these for console log templates
    run_params["_last_tl"] = tl
    run_params["_last_vl"] = vl
    run_params["_last_acc"] = acc
    run_params["_last_lr"] = lr_now
    run_params["_last_gn"] = m["optim/grad_norm"]

    return m


def generate_unique_metrics(run_idx: int, epoch: int, rng: random.Random) -> dict:
    m = {}
    for j in range(5):
        name = f"run_{run_idx}/unique_metric_{j}"
        m[name] = pick_edge_value(rng)
    return m


def emit_console_logs(epoch: int, rng: random.Random, run_params: dict,
                      has_info: bool, has_error: bool):
    """Emit console logs via print() (→INFO) and sys.stderr.write() (→ERROR).

    The Pluto SDK hooks stdout/stderr and automatically captures these as
    console logs with logType=INFO and logType=ERROR respectively.
    """
    tl = run_params.get("_last_tl", 1.0)
    vl = run_params.get("_last_vl", 1.0)
    acc = run_params.get("_last_acc", 0.5)
    lr = run_params.get("_last_lr", 0.001)
    gn = run_params.get("_last_gn", 1.0)

    # INFO logs via print() — captured by SDK as logType=INFO
    if has_info:
        # Always log epoch summary
        print(f"[Epoch {epoch}/{EPOCHS_PER_RUN}] train_loss={tl:.4f} val_loss={vl:.4f} acc={acc:.3f}")
        print(f"  LR: {lr:.6f} | Grad norm: {gn:.3f} | Batch time: {rng.uniform(10, 2000):.1f}ms")

        # Random additional info lines
        if rng.random() < 0.3:
            gpu_mem = rng.uniform(8, 80)
            print(f"  GPU mem: {gpu_mem:.1f}GB | Util: {rng.uniform(0.7, 1.0):.0%} | Throughput: {rng.uniform(500, 80000):.0f} samples/s")
        if epoch > 0 and epoch % 10 == 0:
            print(f"Saving checkpoint at epoch {epoch}...")
            print("Checkpoint saved successfully")
        if rng.random() < 0.1:
            prev = vl * rng.uniform(1.01, 1.1)
            print(f"New best validation loss: {vl:.6f} (previous: {prev:.6f})")

    # ERROR logs via sys.stderr.write() — captured by SDK as logType=ERROR
    if has_error:
        if rng.random() < 0.15:
            size = rng.randint(256, 4096)
            gpu = rng.randint(0, 3)
            free = rng.randint(10, 500)
            sys.stderr.write(f"CUDA out of memory. Tried to allocate {size}MB. GPU {gpu} has {free}MB free\n")
        if rng.random() < 0.1:
            step = epoch * 100 + rng.randint(0, 99)
            sys.stderr.write(f"NaN detected in gradients at epoch {epoch}, step {step}. Skipping batch.\n")
        if rng.random() < 0.2:
            threshold = tl * 0.5
            spike = tl * rng.uniform(2, 5)
            sys.stderr.write(f"WARNING: Loss spike detected: {spike:.4f} (expected < {threshold:.4f})\n")
        if rng.random() < 0.08:
            layer = rng.randint(0, 4)
            sys.stderr.write(f"Gradient overflow detected in layer {layer}. Reducing loss scale.\n")
        if rng.random() < 0.05:
            idx = rng.randint(0, 50000)
            sys.stderr.write(f"Data loading error: corrupted sample at index {idx}. Skipping.\n")
        if rng.random() < 0.1:
            patience = rng.randint(3, 10)
            sys.stderr.write(f"Validation metric decreased for {patience} consecutive epochs.\n")


def create_gradient_image(step: int, total: int, size: int = 64) -> "PILImage.Image":
    arr = np.zeros((size, size, 3), dtype=np.uint8)
    t = step / max(total - 1, 1)
    for y in range(size):
        for x in range(size):
            r = int(255 * (1 - t) * (x / size))
            g = int(255 * t * (y / size))
            b = int(128 + 127 * math.sin(2 * math.pi * t + (x + y) * 0.1))
            arr[y, x] = [min(r, 255), min(g, 255), min(b, 255)]
    return PILImage.fromarray(arr)


def create_run(run_idx: int):
    rng = random.Random(run_idx)
    np_rng = np.random.RandomState(run_idx)

    settings = make_settings()
    config = build_config(run_idx, rng)
    tags = build_tags(rng)

    # Decide which media/log types this run has
    has_histogram = rng.random() < 0.4
    has_image = rng.random() < 0.3 and PIL_AVAILABLE
    has_audio = rng.random() < 0.2
    has_video = rng.random() < 0.15 and PIL_AVAILABLE
    # Console logs: ~60% have INFO, ~40% have ERROR, ~30% have neither
    has_info_logs = rng.random() < 0.6
    has_error_logs = rng.random() < 0.4

    run_name = f"run-{run_idx:04d}"

    run = pluto.init(
        project=PROJECT_NAME,
        name=run_name,
        config=config,
        tags=tags,
        settings=settings,
    )

    run_params = {
        "lr": config["learning_rate"],
        "base_loss": rng.uniform(1.5, 6.0),
        "conv_rate": rng.uniform(0.03, 0.25),
        "noise": rng.uniform(0.005, 0.08),
        "final_acc": rng.uniform(0.55, 0.98),
        "batch_size": config["batch_size"],
    }

    try:
        for epoch in range(EPOCHS_PER_RUN):
            # 100 shared metrics
            shared = generate_shared_metrics(epoch, rng, run_params)
            run.log(shared, step=epoch)

            # 5 unique metrics with edge case values
            unique = generate_unique_metrics(run_idx, epoch, rng)
            run.log(unique, step=epoch)

            # Console logs (print → INFO, stderr → ERROR)
            # These are automatically captured by the SDK
            emit_console_logs(epoch, rng, run_params, has_info_logs, has_error_logs)

            # Histograms
            if has_histogram and epoch % 3 == 0:
                t = epoch / max(EPOCHS_PER_RUN - 1, 1)
                w_std = 0.5 * math.exp(-t) + 0.02
                weights = np_rng.normal(0, w_std, size=1000)
                run.log({"distributions/weights": pluto.Histogram(weights, bins=30)}, step=epoch)
                grads = np_rng.normal(0, 1.0 * math.exp(-2 * t) + 0.01, size=1000)
                run.log({"distributions/gradients": pluto.Histogram(grads, bins=30)}, step=epoch)

            # Images
            if has_image and epoch % 5 == 0:
                img = create_gradient_image(epoch, EPOCHS_PER_RUN)
                run.log({"images/training_viz": pluto.Image(img, caption=f"Epoch {epoch}")}, step=epoch)

            # Audio
            if has_audio and epoch % 10 == 0:
                sr = 16000
                duration = 0.5
                t_audio = np.linspace(0, duration, int(sr * duration), endpoint=False)
                freq = 220 + epoch * 20
                tone = (np.sin(2 * np.pi * freq * t_audio) * 0.5).astype(np.float32)
                run.log({"audio/tone_sample": pluto.Audio(tone, rate=sr)}, step=epoch)

            # Video
            if has_video and epoch % 15 == 0:
                frames = []
                for f_idx in range(10):
                    frame = np.zeros((32, 32, 3), dtype=np.uint8)
                    progress = f_idx / 9
                    frame[:, :, 0] = int(255 * progress)
                    frame[:, :, 1] = int(255 * (1 - progress))
                    frame[:, :, 2] = int(128)
                    frames.append(frame)
                run.log({"video/animation": pluto.Video(np.array(frames), rate=5)}, step=epoch)

        run.finish()
        return run_name, True
    except Exception as e:
        # Use real stderr (not hooked) for our own error reporting
        original_stderr = sys.stderr
        if hasattr(sys.stderr, 'stream'):
            original_stderr = sys.stderr.stream
        original_stderr.write(f"  ERROR run {run_idx}: {e}\n")
        try:
            run.finish()
        except Exception:
            pass
        return run_name, False


def main():
    # Suppress SDK's own noisy output for bulk runs
    logging.getLogger("pluto").setLevel(logging.WARNING)

    # Use original stderr for our progress reporting (before SDK hooks it)
    original_stderr = sys.__stderr__

    original_stderr.write(f"Seeding project '{PROJECT_NAME}' with {NUM_RUNS} runs\n")
    original_stderr.write(f"  Epochs per run: {EPOCHS_PER_RUN}\n")
    original_stderr.write(f"  Shared metrics: {len(SHARED_METRICS)}\n")
    original_stderr.write(f"  Unique metrics per run: 5\n")
    original_stderr.write(f"  PIL available: {PIL_AVAILABLE}\n")
    original_stderr.write(f"  Console logs: INFO (stdout) + ERROR (stderr)\n")
    original_stderr.write("\n")

    start = time.time()
    completed = 0
    failed = 0

    for i in range(NUM_RUNS):
        name, ok = create_run(i)
        if ok:
            completed += 1
        else:
            failed += 1

        if (i + 1) % 10 == 0:
            elapsed = time.time() - start
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            original_stderr.write(
                f"  [{i + 1}/{NUM_RUNS}] {rate:.1f} runs/s | completed={completed} failed={failed}\n"
            )

    elapsed = time.time() - start
    original_stderr.write(f"\nDone in {elapsed:.1f}s ({completed} ok, {failed} failed)\n")
    if elapsed > 0:
        original_stderr.write(f"  Rate: {completed / elapsed:.1f} runs/s\n")


if __name__ == "__main__":
    main()
