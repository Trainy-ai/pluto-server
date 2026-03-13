locals {
  namespace   = "mlop"
  app_host    = "${var.app_subdomain}.${var.domain}"
  api_host    = "${var.api_subdomain}.${var.domain}"
  ingest_host = "${var.ingest_subdomain}.${var.domain}"
  py_host     = "${var.py_subdomain}.${var.domain}"
  redis_url   = "redis://:${var.redis_password}@redis-master.${local.namespace}.svc.cluster.local:6379"
}

# =============================================================================
# Namespace
# =============================================================================

resource "kubernetes_namespace" "mlop" {
  metadata {
    name = local.namespace
  }
}

# =============================================================================
# StorageClass (gp3)
# =============================================================================

resource "kubernetes_storage_class" "gp3" {
  metadata {
    name = "gp3"
    annotations = {
      "storageclass.kubernetes.io/is-default-class" = "true"
    }
  }
  storage_provisioner = "ebs.csi.eks.amazonaws.com"
  parameters = {
    type   = "gp3"
    fsType = "ext4"
  }
  reclaim_policy      = "Delete"
  volume_binding_mode = "WaitForFirstConsumer"
}

# =============================================================================
# ConfigMap — non-sensitive environment variables
# =============================================================================

resource "kubernetes_config_map" "mlop" {
  metadata {
    name      = "mlop-config"
    namespace = local.namespace
  }

  data = {
    NODE_ENV           = "production"
    SELF_HOSTED        = "true"
    IS_DOCKER          = "true"
    VERCEL             = "1"
    PUBLIC_URL         = "https://${local.api_host}"
    BETTER_AUTH_URL    = "https://${local.app_host}"
    ADDITIONAL_ORIGINS = "https://${local.app_host}"
    CLICKHOUSE_URL     = var.clickhouse_url
    CLICKHOUSE_USER    = var.clickhouse_user
    STORAGE_ENDPOINT   = var.storage_endpoint
    STORAGE_BUCKET     = var.storage_bucket
    STORAGE_REGION     = var.storage_region
  }

  depends_on = [kubernetes_namespace.mlop]
}

# =============================================================================
# Secret — sensitive environment variables
# =============================================================================

resource "kubernetes_secret" "mlop" {
  metadata {
    name      = "mlop-secrets"
    namespace = local.namespace
  }

  data = merge(
    {
      DATABASE_URL              = var.database_url
      DATABASE_DIRECT_URL       = var.database_direct_url
      CLICKHOUSE_PASSWORD       = var.clickhouse_password
      STORAGE_ACCESS_KEY_ID     = var.storage_access_key_id
      STORAGE_SECRET_ACCESS_KEY = var.storage_secret_access_key
      BETTER_AUTH_SECRET        = var.better_auth_secret
      REDIS_URL                 = local.redis_url
      # OAuth credentials — always included (backend env validation requires them)
      # Use "not-configured" placeholder when empty so Zod min(1) passes
      GITHUB_CLIENT_ID     = var.github_client_id != "" ? var.github_client_id : "not-configured"
      GITHUB_CLIENT_SECRET = var.github_client_secret != "" ? var.github_client_secret : "not-configured"
      GOOGLE_CLIENT_ID     = var.google_client_id != "" ? var.google_client_id : "not-configured"
      GOOGLE_CLIENT_SECRET = var.google_client_secret != "" ? var.google_client_secret : "not-configured"
    },
    var.resend_api_key != "" ? { RESEND_API_KEY = var.resend_api_key } : {},
    var.resend_from_email != "" ? { RESEND_FROM_EMAIL = var.resend_from_email } : {},
  )

  depends_on = [kubernetes_namespace.mlop]
}

# =============================================================================
# Backend Deployment + Service
# =============================================================================

resource "kubernetes_deployment" "backend" {
  metadata {
    name      = "backend"
    namespace = local.namespace
    labels    = { app = "backend" }
  }

  spec {
    replicas = 3

    selector {
      match_labels = { app = "backend" }
    }

    template {
      metadata {
        labels = { app = "backend" }
      }

      spec {
        container {
          name  = "backend"
          image = "asaiacai/mlop-backend:${var.image_tag}"

          port {
            container_port = 3001
          }

          env_from {
            config_map_ref {
              name = kubernetes_config_map.mlop.metadata[0].name
            }
          }

          env_from {
            secret_ref {
              name = kubernetes_secret.mlop.metadata[0].name
            }
          }

          resources {
            requests = {
              cpu    = "1"
              memory = "1.5Gi"
            }
            limits = {
              cpu    = "2"
              memory = "2Gi"
            }
          }

          liveness_probe {
            http_get {
              path = "/api/health"
              port = 3001
            }
            initial_delay_seconds = 30
            period_seconds        = 10
          }

          readiness_probe {
            http_get {
              path = "/api/health"
              port = 3001
            }
            initial_delay_seconds = 10
            period_seconds        = 5
          }
        }
      }
    }
  }

  depends_on = [kubernetes_namespace.mlop]
}

resource "kubernetes_service" "backend" {
  metadata {
    name      = "backend"
    namespace = local.namespace
  }

  spec {
    selector = { app = "backend" }

    port {
      port        = 3001
      target_port = 3001
    }

    type = "ClusterIP"
  }
}

# =============================================================================
# Frontend Deployment + Service
# =============================================================================

resource "kubernetes_deployment" "frontend" {
  metadata {
    name      = "frontend"
    namespace = local.namespace
    labels    = { app = "frontend" }
  }

  spec {
    replicas = 2

    selector {
      match_labels = { app = "frontend" }
    }

    template {
      metadata {
        labels = { app = "frontend" }
      }

      spec {
        container {
          name  = "frontend"
          image = "asaiacai/mlop-frontend:${var.image_tag}"

          port {
            container_port = 3000
          }

          resources {
            requests = {
              cpu    = "100m"
              memory = "256Mi"
            }
            limits = {
              cpu    = "200m"
              memory = "512Mi"
            }
          }

          liveness_probe {
            http_get {
              path = "/"
              port = 3000
            }
            initial_delay_seconds = 15
            period_seconds        = 10
          }

          readiness_probe {
            http_get {
              path = "/"
              port = 3000
            }
            initial_delay_seconds = 5
            period_seconds        = 5
          }

          env {
            name  = "VITE_SERVER_URL"
            value = "https://${local.api_host}"
          }
        }
      }
    }
  }

  depends_on = [kubernetes_namespace.mlop]
}

resource "kubernetes_service" "frontend" {
  metadata {
    name      = "frontend"
    namespace = local.namespace
  }

  spec {
    selector = { app = "frontend" }

    port {
      port        = 3000
      target_port = 3000
    }

    type = "ClusterIP"
  }
}

# =============================================================================
# Ingest Deployment + Service
# =============================================================================

resource "kubernetes_deployment" "ingest" {
  metadata {
    name      = "ingest"
    namespace = local.namespace
    labels    = { app = "ingest" }
  }

  spec {
    replicas = 3

    selector {
      match_labels = { app = "ingest" }
    }

    template {
      metadata {
        labels = { app = "ingest" }
      }

      spec {
        container {
          name  = "ingest"
          image = "asaiacai/mlop-ingest:${var.image_tag}"

          port {
            container_port = 3003
          }

          env_from {
            config_map_ref {
              name = kubernetes_config_map.mlop.metadata[0].name
            }
          }

          env_from {
            secret_ref {
              name = kubernetes_secret.mlop.metadata[0].name
            }
          }

          resources {
            requests = {
              cpu    = "250m"
              memory = "256Mi"
            }
            limits = {
              cpu    = "500m"
              memory = "512Mi"
            }
          }

          volume_mount {
            name       = "dlq"
            mount_path = "/var/mlop/dlq"
          }

          liveness_probe {
            http_get {
              path = "/health"
              port = 3003
            }
            initial_delay_seconds = 10
            period_seconds        = 10
          }

          readiness_probe {
            http_get {
              path = "/health"
              port = 3003
            }
            initial_delay_seconds = 5
            period_seconds        = 5
          }
        }

        volume {
          name = "dlq"
          empty_dir {}
        }
      }
    }
  }

  depends_on = [kubernetes_namespace.mlop]
}

resource "kubernetes_service" "ingest" {
  metadata {
    name      = "ingest"
    namespace = local.namespace
  }

  spec {
    selector = { app = "ingest" }

    port {
      port        = 3003
      target_port = 3003
    }

    type = "ClusterIP"
  }
}

# =============================================================================
# Python Service Deployment + Service
# =============================================================================

resource "kubernetes_deployment" "py" {
  metadata {
    name      = "py"
    namespace = local.namespace
    labels    = { app = "py" }
  }

  spec {
    replicas = 1

    selector {
      match_labels = { app = "py" }
    }

    template {
      metadata {
        labels = { app = "py" }
      }

      spec {
        container {
          name  = "py"
          image = "asaiacai/mlop-py:${var.image_tag}"

          port {
            container_port = 3004
          }

          env_from {
            config_map_ref {
              name = kubernetes_config_map.mlop.metadata[0].name
            }
          }

          env_from {
            secret_ref {
              name = kubernetes_secret.mlop.metadata[0].name
            }
          }

          resources {
            requests = {
              cpu    = "500m"
              memory = "1Gi"
            }
            limits = {
              cpu    = "500m"
              memory = "1Gi"
            }
          }

          liveness_probe {
            http_get {
              path = "/healthz"
              port = 3004
            }
            initial_delay_seconds = 15
            period_seconds        = 10
          }

          readiness_probe {
            http_get {
              path = "/healthz"
              port = 3004
            }
            initial_delay_seconds = 5
            period_seconds        = 5
          }
        }
      }
    }
  }

  depends_on = [kubernetes_namespace.mlop]
}

resource "kubernetes_service" "py" {
  metadata {
    name      = "py"
    namespace = local.namespace
  }

  spec {
    selector = { app = "py" }

    port {
      port        = 3004
      target_port = 3004
    }

    type = "ClusterIP"
  }
}
