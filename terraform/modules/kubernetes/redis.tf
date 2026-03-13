# =============================================================================
# Redis — Bitnami Helm chart (standalone mode)
# =============================================================================

resource "helm_release" "redis" {
  name       = "redis"
  repository = "oci://registry-1.docker.io/bitnamicharts"
  chart      = "redis"
  namespace  = local.namespace
  version    = "25.3.2"

  set {
    name  = "architecture"
    value = "standalone"
  }


  set {
    name  = "auth.password"
    value = var.redis_password
  }

  set {
    name  = "master.persistence.size"
    value = "1Gi"
  }

  set {
    name  = "master.persistence.storageClass"
    value = "gp3"
  }

  set {
    name  = "master.resources.requests.cpu"
    value = "100m"
  }

  set {
    name  = "master.resources.requests.memory"
    value = "128Mi"
  }

  set {
    name  = "master.resources.limits.memory"
    value = "256Mi"
  }

  set {
    name  = "master.configuration"
    value = "maxmemory 256mb\nmaxmemory-policy allkeys-lru"
  }

  depends_on = [
    kubernetes_namespace.mlop,
    kubernetes_storage_class.gp3,
  ]
}
