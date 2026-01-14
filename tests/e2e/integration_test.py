"""
End-to-end integration test for pluto platform.

This test validates the full stack deployment by:
1. Configuring pluto to use local services
2. Initializing a run with configuration
3. Logging metrics over multiple epochs
4. Optionally logging images (TEST_IMAGE_LOGGING=true)
5. Optionally logging text files of various formats (TEST_FILE_LOGGING=true)
6. Finishing the run successfully
"""

import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import pluto

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


def create_sample_files(temp_dir: str) -> dict[str, str]:
    """Create sample files for each supported text format.

    Returns:
        Dictionary mapping filename to file path.
    """
    samples = {
        # Python
        "sample.py": '''"""Sample Python module for testing syntax highlighting."""

import json
from dataclasses import dataclass
from typing import Optional


@dataclass
class TrainingConfig:
    """Configuration for model training."""
    learning_rate: float = 0.001
    batch_size: int = 32
    epochs: int = 10
    optimizer: str = "adam"


def train_model(config: Optional[TrainingConfig] = None) -> dict:
    """Train the model with the given configuration."""
    if config is None:
        config = TrainingConfig()

    print(f"Training with lr={config.learning_rate}")
    return {"loss": 0.01, "accuracy": 0.99}


if __name__ == "__main__":
    result = train_model()
    print(json.dumps(result, indent=2))
''',

        # JavaScript
        "sample.js": '''/**
 * Sample JavaScript module for testing syntax highlighting.
 */

const CONFIG = {
  apiUrl: "https://api.example.com",
  timeout: 5000,
  retries: 3,
};

class DataLoader {
  constructor(options = {}) {
    this.config = { ...CONFIG, ...options };
    this.cache = new Map();
  }

  async fetch(endpoint) {
    const url = `${this.config.apiUrl}/${endpoint}`;

    if (this.cache.has(url)) {
      return this.cache.get(url);
    }

    const response = await fetch(url, {
      timeout: this.config.timeout,
    });

    const data = await response.json();
    this.cache.set(url, data);
    return data;
  }
}

export { DataLoader, CONFIG };
''',

        # TypeScript
        "sample.ts": '''/**
 * Sample TypeScript module for testing syntax highlighting.
 */

interface ModelMetrics {
  loss: number;
  accuracy: number;
  epoch: number;
  timestamp: Date;
}

interface TrainingOptions {
  learningRate?: number;
  batchSize?: number;
  callbacks?: ((metrics: ModelMetrics) => void)[];
}

class ModelTrainer<T extends Record<string, unknown>> {
  private config: T;
  private metrics: ModelMetrics[] = [];

  constructor(config: T) {
    this.config = config;
  }

  train(options: TrainingOptions = {}): Promise<ModelMetrics[]> {
    const { learningRate = 0.001, batchSize = 32 } = options;

    return new Promise((resolve) => {
      const finalMetrics: ModelMetrics = {
        loss: 0.01,
        accuracy: 0.99,
        epoch: 10,
        timestamp: new Date(),
      };

      this.metrics.push(finalMetrics);
      resolve(this.metrics);
    });
  }
}

export type { ModelMetrics, TrainingOptions };
export { ModelTrainer };
''',

        # Go
        "sample.go": '''// Package main demonstrates Go syntax highlighting.
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
)

// Config holds the training configuration.
type Config struct {
	LearningRate float64 `json:"learning_rate"`
	BatchSize    int     `json:"batch_size"`
	Epochs       int     `json:"epochs"`
}

// Trainer manages model training.
type Trainer struct {
	config Config
	mu     sync.RWMutex
	loss   float64
}

// NewTrainer creates a new Trainer with the given config.
func NewTrainer(cfg Config) *Trainer {
	return &Trainer{
		config: cfg,
		loss:   1.0,
	}
}

// Train runs the training loop.
func (t *Trainer) Train() error {
	for epoch := 0; epoch < t.config.Epochs; epoch++ {
		t.mu.Lock()
		t.loss *= 0.9
		t.mu.Unlock()

		fmt.Printf("Epoch %d: loss=%.4f\\n", epoch, t.loss)
	}
	return nil
}

func main() {
	cfg := Config{
		LearningRate: 0.001,
		BatchSize:    32,
		Epochs:       10,
	}

	data, _ := json.MarshalIndent(cfg, "", "  ")
	log.Printf("Config: %s", data)

	trainer := NewTrainer(cfg)
	if err := trainer.Train(); err != nil {
		log.Fatal(err)
	}
}
''',

        # Rust
        "sample.rs": '''//! Sample Rust module for testing syntax highlighting.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// Configuration for model training.
#[derive(Debug, Clone)]
pub struct TrainingConfig {
    pub learning_rate: f64,
    pub batch_size: usize,
    pub epochs: usize,
}

impl Default for TrainingConfig {
    fn default() -> Self {
        Self {
            learning_rate: 0.001,
            batch_size: 32,
            epochs: 10,
        }
    }
}

/// Trainer manages the training process.
pub struct Trainer {
    config: TrainingConfig,
    metrics: Arc<RwLock<HashMap<String, f64>>>,
}

impl Trainer {
    pub fn new(config: TrainingConfig) -> Self {
        Self {
            config,
            metrics: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn train(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let mut loss = 1.0_f64;

        for epoch in 0..self.config.epochs {
            loss *= 0.9;

            let mut metrics = self.metrics.write().unwrap();
            metrics.insert("loss".to_string(), loss);
            metrics.insert("epoch".to_string(), epoch as f64);

            println!("Epoch {}: loss={:.4}", epoch, loss);
        }

        Ok(())
    }
}

fn main() {
    let config = TrainingConfig::default();
    let mut trainer = Trainer::new(config);

    if let Err(e) = trainer.train() {
        eprintln!("Training failed: {}", e);
    }
}
''',

        # Java
        "sample.java": '''package com.example.training;

import java.util.HashMap;
import java.util.Map;
import java.util.logging.Logger;

/**
 * Sample Java class for testing syntax highlighting.
 */
public class ModelTrainer {
    private static final Logger LOGGER = Logger.getLogger(ModelTrainer.class.getName());

    private final double learningRate;
    private final int batchSize;
    private final int epochs;
    private final Map<String, Double> metrics;

    public ModelTrainer(double learningRate, int batchSize, int epochs) {
        this.learningRate = learningRate;
        this.batchSize = batchSize;
        this.epochs = epochs;
        this.metrics = new HashMap<>();
    }

    public void train() {
        double loss = 1.0;

        for (int epoch = 0; epoch < epochs; epoch++) {
            loss *= 0.9;
            metrics.put("loss", loss);
            metrics.put("epoch", (double) epoch);

            LOGGER.info(String.format("Epoch %d: loss=%.4f", epoch, loss));
        }
    }

    public Map<String, Double> getMetrics() {
        return new HashMap<>(metrics);
    }

    public static void main(String[] args) {
        ModelTrainer trainer = new ModelTrainer(0.001, 32, 10);
        trainer.train();
        System.out.println("Final metrics: " + trainer.getMetrics());
    }
}
''',

        # Ruby
        "sample.rb": '''# frozen_string_literal: true

# Sample Ruby class for testing syntax highlighting.

require 'json'
require 'logger'

module Training
  # Configuration for model training.
  class Config
    attr_accessor :learning_rate, :batch_size, :epochs

    def initialize(learning_rate: 0.001, batch_size: 32, epochs: 10)
      @learning_rate = learning_rate
      @batch_size = batch_size
      @epochs = epochs
    end

    def to_h
      {
        learning_rate: @learning_rate,
        batch_size: @batch_size,
        epochs: @epochs
      }
    end
  end

  # Trainer manages the training process.
  class Trainer
    def initialize(config = Config.new)
      @config = config
      @logger = Logger.new($stdout)
      @metrics = {}
    end

    def train
      loss = 1.0

      @config.epochs.times do |epoch|
        loss *= 0.9
        @metrics[:loss] = loss
        @metrics[:epoch] = epoch

        @logger.info("Epoch #{epoch}: loss=#{format('%.4f', loss)}")
      end

      @metrics
    end
  end
end

if __FILE__ == $PROGRAM_NAME
  config = Training::Config.new(learning_rate: 0.001)
  trainer = Training::Trainer.new(config)
  result = trainer.train
  puts JSON.pretty_generate(result)
end
''',

        # Shell/Bash
        "sample.sh": '''#!/bin/bash
# Sample shell script for testing syntax highlighting.

set -euo pipefail

# Configuration
LEARNING_RATE="${LEARNING_RATE:-0.001}"
BATCH_SIZE="${BATCH_SIZE:-32}"
EPOCHS="${EPOCHS:-10}"
OUTPUT_DIR="${OUTPUT_DIR:-./output}"

# Colors for output
RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
NC='\\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Run training
train_model() {
    local epoch=$1
    log_info "Training epoch $epoch with lr=$LEARNING_RATE"

    # Simulate training
    sleep 0.1
    echo "loss: 0.$((RANDOM % 100))" >> "$OUTPUT_DIR/metrics.txt"
}

main() {
    log_info "Starting training..."
    log_info "Config: lr=$LEARNING_RATE, batch=$BATCH_SIZE, epochs=$EPOCHS"

    for ((i=0; i<EPOCHS; i++)); do
        train_model "$i"
    done

    log_info "Training complete! Results in $OUTPUT_DIR"
}

main "$@"
''',

        # YAML
        "config.yaml": '''# Training configuration
# This file demonstrates YAML syntax highlighting

model:
  name: "transformer-base"
  architecture:
    type: "encoder-decoder"
    layers: 6
    hidden_size: 512
    attention_heads: 8
    dropout: 0.1

training:
  learning_rate: 0.001
  batch_size: 32
  epochs: 100
  optimizer:
    name: "adam"
    betas: [0.9, 0.999]
    weight_decay: 0.01

  scheduler:
    name: "cosine"
    warmup_steps: 1000
    min_lr: 1.0e-6

data:
  train_path: "./data/train.jsonl"
  valid_path: "./data/valid.jsonl"
  max_length: 512
  preprocessing:
    - lowercase: true
    - remove_punctuation: false
    - tokenizer: "bpe"

logging:
  level: INFO
  save_dir: "./logs"
  wandb:
    enabled: true
    project: "my-project"
    tags:
      - "baseline"
      - "v1.0"
''',

        # JSON
        "package.json": '''{
  "name": "ml-training-pipeline",
  "version": "1.0.0",
  "description": "Machine learning training pipeline",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts",
    "test": "jest --coverage",
    "lint": "eslint src/**/*.ts"
  },
  "dependencies": {
    "@tensorflow/tfjs-node": "^4.10.0",
    "express": "^4.18.2",
    "winston": "^3.10.0"
  },
  "devDependencies": {
    "@types/node": "^20.4.5",
    "typescript": "^5.1.6",
    "jest": "^29.6.2"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "keywords": [
    "machine-learning",
    "training",
    "pipeline"
  ],
  "author": "ML Team",
  "license": "MIT"
}
''',

        # TOML
        "config.toml": '''# Sample TOML configuration file

[project]
name = "ml-experiment"
version = "0.1.0"
authors = ["ML Team <team@example.com>"]
description = "Machine learning experiment configuration"

[model]
architecture = "transformer"
hidden_size = 512
num_layers = 6
num_heads = 8
dropout = 0.1

[training]
learning_rate = 0.001
batch_size = 32
epochs = 100
gradient_clip = 1.0
mixed_precision = true

[training.optimizer]
type = "adamw"
betas = [0.9, 0.999]
weight_decay = 0.01

[data]
train_file = "data/train.jsonl"
valid_file = "data/valid.jsonl"
max_sequence_length = 512

[logging]
level = "INFO"
format = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"

[wandb]
enabled = true
project = "ml-experiments"
entity = "my-team"
''',

        # INI
        "settings.ini": '''# Application settings
# Sample INI file for testing syntax highlighting

[general]
app_name = ML Training Pipeline
version = 1.0.0
debug = false
log_level = INFO

[database]
host = localhost
port = 5432
name = ml_experiments
user = postgres
password = secret123
pool_size = 10

[model]
architecture = transformer
checkpoint_dir = ./checkpoints
save_frequency = 1000

[training]
learning_rate = 0.001
batch_size = 32
epochs = 100
early_stopping = true
patience = 5

[paths]
data_dir = ./data
output_dir = ./output
cache_dir = ./cache
''',

        # XML
        "config.xml": '''<?xml version="1.0" encoding="UTF-8"?>
<!-- Sample XML configuration file -->
<configuration>
    <project>
        <name>ML Training Pipeline</name>
        <version>1.0.0</version>
        <description>Machine learning experiment configuration</description>
    </project>

    <model>
        <architecture>transformer</architecture>
        <parameters>
            <hidden_size>512</hidden_size>
            <num_layers>6</num_layers>
            <num_heads>8</num_heads>
            <dropout>0.1</dropout>
        </parameters>
    </model>

    <training>
        <learning_rate>0.001</learning_rate>
        <batch_size>32</batch_size>
        <epochs>100</epochs>
        <optimizer type="adam">
            <beta1>0.9</beta1>
            <beta2>0.999</beta2>
            <weight_decay>0.01</weight_decay>
        </optimizer>
    </training>

    <data>
        <paths>
            <train>./data/train.jsonl</train>
            <valid>./data/valid.jsonl</valid>
        </paths>
        <preprocessing>
            <max_length>512</max_length>
            <lowercase>true</lowercase>
        </preprocessing>
    </data>
</configuration>
''',

        # CSV
        "metrics.csv": '''epoch,train_loss,valid_loss,train_accuracy,valid_accuracy,learning_rate,timestamp
0,2.3456,2.4567,0.1234,0.1123,0.001,2024-01-15T10:00:00
1,1.8765,1.9876,0.2345,0.2234,0.001,2024-01-15T10:05:00
2,1.4321,1.5432,0.3456,0.3345,0.001,2024-01-15T10:10:00
3,1.1234,1.2345,0.4567,0.4456,0.0008,2024-01-15T10:15:00
4,0.8765,0.9876,0.5678,0.5567,0.0008,2024-01-15T10:20:00
5,0.6543,0.7654,0.6789,0.6678,0.0006,2024-01-15T10:25:00
6,0.4321,0.5432,0.7890,0.7789,0.0006,2024-01-15T10:30:00
7,0.2345,0.3456,0.8901,0.8790,0.0004,2024-01-15T10:35:00
8,0.1234,0.2345,0.9234,0.9123,0.0004,2024-01-15T10:40:00
9,0.0567,0.1678,0.9567,0.9456,0.0002,2024-01-15T10:45:00
''',

        # SQL
        "schema.sql": '''-- Database schema for ML experiment tracking
-- Sample SQL file for testing syntax highlighting

CREATE TABLE IF NOT EXISTS experiments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS runs (
    id SERIAL PRIMARY KEY,
    experiment_id INTEGER REFERENCES experiments(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    config JSONB NOT NULL DEFAULT '{}',
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    status VARCHAR(50) DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS metrics (
    id SERIAL PRIMARY KEY,
    run_id INTEGER REFERENCES runs(id) ON DELETE CASCADE,
    step INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_metrics_run_id ON metrics(run_id);
CREATE INDEX idx_metrics_name ON metrics(name);
CREATE INDEX idx_runs_experiment_id ON runs(experiment_id);

-- Insert sample data
INSERT INTO experiments (name, description)
VALUES ('baseline-transformer', 'Baseline transformer model experiment');

INSERT INTO runs (experiment_id, name, config, status)
VALUES (
    1,
    'run-001',
    '{"learning_rate": 0.001, "batch_size": 32, "epochs": 10}',
    'completed'
);

-- Query example
SELECT
    e.name AS experiment_name,
    r.name AS run_name,
    AVG(m.value) AS avg_loss
FROM experiments e
JOIN runs r ON e.id = r.experiment_id
JOIN metrics m ON r.id = m.run_id
WHERE m.name = 'loss'
GROUP BY e.name, r.name
ORDER BY avg_loss ASC;
''',

        # Markdown
        "README.md": '''# ML Training Pipeline

A comprehensive machine learning training pipeline with experiment tracking.

## Features

- **Model Training**: Support for various architectures
- **Experiment Tracking**: Automatic logging of metrics and artifacts
- **Distributed Training**: Multi-GPU and multi-node support

## Installation

```bash
pip install -r requirements.txt
```

## Quick Start

```python
from pipeline import Trainer, Config

config = Config(
    learning_rate=0.001,
    batch_size=32,
    epochs=10
)

trainer = Trainer(config)
trainer.train()
```

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `learning_rate` | 0.001 | Initial learning rate |
| `batch_size` | 32 | Training batch size |
| `epochs` | 100 | Number of training epochs |

## Results

Our baseline model achieves:

- **Accuracy**: 95.6%
- **F1 Score**: 0.94
- **Inference Time**: 12ms

## License

MIT License - see [LICENSE](LICENSE) for details.
''',

        # Plain text
        "notes.txt": '''ML Experiment Notes
===================

Date: 2024-01-15
Experiment: baseline-transformer-v1

Observations:
-------------
1. Learning rate of 0.001 works well for initial training
2. Batch size of 32 gives good GPU utilization (~85%)
3. Model converges after approximately 50 epochs

Hyperparameters tested:
- Learning rate: 0.0001, 0.001, 0.01
- Batch size: 16, 32, 64, 128
- Dropout: 0.1, 0.2, 0.3

Best configuration:
  learning_rate = 0.001
  batch_size = 32
  dropout = 0.1
  epochs = 100

TODO:
-----
[ ] Try different optimizers (SGD, AdamW)
[ ] Implement learning rate scheduling
[ ] Add gradient clipping
[ ] Test with larger model

Next steps:
-----------
1. Run ablation studies on model size
2. Collect more training data
3. Implement early stopping

Contact: team@example.com
''',

        # Log file
        "training.log": '''2024-01-15 10:00:00,123 - INFO - Starting training pipeline
2024-01-15 10:00:00,456 - INFO - Loading configuration from config.yaml
2024-01-15 10:00:01,789 - INFO - Model architecture: transformer
2024-01-15 10:00:02,012 - INFO - Parameters: 124,439,808
2024-01-15 10:00:02,345 - INFO - Loading training data from ./data/train.jsonl
2024-01-15 10:00:05,678 - INFO - Loaded 50000 training examples
2024-01-15 10:00:05,901 - INFO - Loading validation data from ./data/valid.jsonl
2024-01-15 10:00:06,234 - INFO - Loaded 5000 validation examples
2024-01-15 10:00:06,567 - INFO - Starting epoch 1/100
2024-01-15 10:01:23,890 - INFO - Epoch 1: train_loss=2.3456, valid_loss=2.4567
2024-01-15 10:01:24,123 - INFO - Starting epoch 2/100
2024-01-15 10:02:41,456 - INFO - Epoch 2: train_loss=1.8765, valid_loss=1.9876
2024-01-15 10:02:41,789 - WARNING - Learning rate scheduler: reducing lr to 0.0008
2024-01-15 10:02:42,012 - INFO - Starting epoch 3/100
2024-01-15 10:03:59,345 - INFO - Epoch 3: train_loss=1.4321, valid_loss=1.5432
2024-01-15 10:04:00,678 - INFO - Checkpoint saved: ./checkpoints/model_epoch_3.pt
2024-01-15 10:04:01,901 - DEBUG - GPU memory usage: 8.2GB / 16GB
2024-01-15 10:04:02,234 - INFO - Starting epoch 4/100
2024-01-15 10:05:19,567 - ERROR - CUDA out of memory. Reducing batch size.
2024-01-15 10:05:20,890 - INFO - Retrying with batch_size=16
2024-01-15 10:06:37,123 - INFO - Epoch 4: train_loss=1.1234, valid_loss=1.2345
2024-01-15 10:06:38,456 - INFO - Training completed successfully
2024-01-15 10:06:39,789 - INFO - Best model: epoch 4, valid_loss=1.2345
''',
    }

    # Write files to temp directory
    file_paths = {}
    for filename, content in samples.items():
        filepath = os.path.join(temp_dir, filename)
        with open(filepath, 'w') as f:
            f.write(content)
        file_paths[filename] = filepath

    return file_paths


def main():
    # Configure pluto to use local self-hosted instance
    settings = pluto.Settings()
    if os.getenv('TEST_LOCAL', '').lower() in ('true', '1', 'yes'):
        settings.update({
            'url_app': 'http://localhost:3000',
            'url_api': 'http://localhost:3001',
            'url_ingest': 'http://localhost:3003',
            'url_py': 'http://localhost:3004',
        })
    else:
        settings.update({
            'url_app': 'https://pluto-dev.trainy.ai',
            'url_api': 'https://pluto-api-dev.trainy.ai',
            'url_ingest': 'https://pluto-ingest-dev.trainy.ai',
            'url_py': 'https://pluto-py-dev.trainy.ai'
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

    run = pluto.init(
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
                run.log({"test/square": pluto.Image(square)}, step=step)
                print(f"  Step {step}: Logged {name} square")
        else:
            print("\nWarning: PIL/Pillow not available, skipping image logging")
    else:
        print("\nSkipping image logging (set TEST_IMAGE_LOGGING=true to enable)")

    # Conditional: Log text files of various formats for text viewer testing
    # Note: We create the temp directory outside the context manager so files persist
    # until after run.finish() completes (pluto uploads files asynchronously)
    temp_dir = None
    if os.getenv('TEST_FILE_LOGGING', '').lower() in ('true', '1', 'yes'):
        print("\nLogging text files for text viewer testing...")

        temp_dir = tempfile.mkdtemp()
        file_paths = create_sample_files(temp_dir)

        for step, (filename, filepath) in enumerate(file_paths.items()):
            # Use filename without extension as log name prefix
            name_without_ext = filename.rsplit('.', 1)[0]
            log_name = f"files/{name_without_ext}"

            run.log({log_name: pluto.Text(filepath)}, step=step)
            print(f"  Step {step}: Logged {filename}")

        print(f"\nLogged {len(file_paths)} text files across various formats")
    else:
        print("\nSkipping file logging (set TEST_FILE_LOGGING=true to enable)")

    print("\nFinishing run...")
    run.finish()

    # Clean up temp directory after run.finish() ensures uploads are complete
    if temp_dir:
        shutil.rmtree(temp_dir, ignore_errors=True)

    print("Integration test completed successfully!")


if __name__ == '__main__':
    main()
