# Version info extracted from git
GIT_COMMIT := $(shell git rev-parse HEAD 2>/dev/null || echo unknown)
GIT_BRANCH := $(shell git branch --show-current 2>/dev/null || echo unknown)
BUILD_TIME := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
SERVICE_VERSION := dev

export GIT_COMMIT GIT_BRANCH BUILD_TIME SERVICE_VERSION

.PHONY: up down build logs

up:
	docker compose --env-file .env up --build

up-d:
	docker compose --env-file .env up --build -d

down:
	docker compose down

build:
	docker compose --env-file .env build

logs:
	docker compose logs -f
