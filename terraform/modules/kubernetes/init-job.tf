# =============================================================================
# Init Jobs — ClickHouse table creation + Prisma migration
# =============================================================================

# Job 1: Create ClickHouse tables
resource "kubernetes_job" "clickhouse_init" {
  metadata {
    name      = "clickhouse-init"
    namespace = local.namespace
  }

  spec {
    backoff_limit = 3

    template {
      metadata {
        labels = { job = "clickhouse-init" }
      }

      spec {
        restart_policy = "OnFailure"

        container {
          name  = "clickhouse-init"
          image = "asaiacai/mlop-ingest:${var.image_tag}"

          command = ["/bin/sh", "-c", "/opt/docker-setup/create_tables.sh"]

          env {
            name  = "CLICKHOUSE_URL"
            value = var.clickhouse_url
          }
          env {
            name  = "CLICKHOUSE_USER"
            value = var.clickhouse_user
          }
          env {
            name = "CLICKHOUSE_PASSWORD"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.mlop.metadata[0].name
                key  = "CLICKHOUSE_PASSWORD"
              }
            }
          }
        }
      }
    }
  }

  wait_for_completion = true

  timeouts {
    create = "5m"
  }

  depends_on = [kubernetes_namespace.mlop]
}

# Job 2: Run Prisma migrations (after ClickHouse tables are ready)
resource "kubernetes_job" "prisma_migrate" {
  metadata {
    name      = "prisma-migrate"
    namespace = local.namespace
  }

  spec {
    backoff_limit = 3

    template {
      metadata {
        labels = { job = "prisma-migrate" }
      }

      spec {
        restart_policy = "OnFailure"

        container {
          name  = "prisma-migrate"
          image = "asaiacai/mlop-backend:${var.image_tag}"

          command = ["npx", "prisma", "migrate", "deploy"]

          env {
            name = "DATABASE_URL"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.mlop.metadata[0].name
                key  = "DATABASE_URL"
              }
            }
          }
          env {
            name = "DATABASE_DIRECT_URL"
            value_from {
              secret_key_ref {
                name = kubernetes_secret.mlop.metadata[0].name
                key  = "DATABASE_DIRECT_URL"
              }
            }
          }
        }
      }
    }
  }

  wait_for_completion = true

  timeouts {
    create = "5m"
  }

  depends_on = [kubernetes_job.clickhouse_init]
}
