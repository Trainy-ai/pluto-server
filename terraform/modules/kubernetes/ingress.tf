# =============================================================================
# ALB Ingress — host-based routing for all services
# =============================================================================

resource "kubernetes_ingress_v1" "mlop" {
  metadata {
    name      = "mlop-ingress"
    namespace = local.namespace

    annotations = {
      "kubernetes.io/ingress.class"                = "alb"
      "alb.ingress.kubernetes.io/scheme"           = "internet-facing"
      "alb.ingress.kubernetes.io/target-type"      = "ip"
      "alb.ingress.kubernetes.io/healthcheck-path" = "/health"
      "alb.ingress.kubernetes.io/listen-ports"     = "[{\"HTTPS\":443}]"
      "alb.ingress.kubernetes.io/certificate-arn"  = var.acm_certificate_arn
      "alb.ingress.kubernetes.io/ssl-redirect"     = "443"
    }
  }

  spec {
    ingress_class_name = "alb"

    # Frontend
    rule {
      host = local.app_host

      http {
        path {
          path      = "/"
          path_type = "Prefix"

          backend {
            service {
              name = kubernetes_service.frontend.metadata[0].name
              port {
                number = 3000
              }
            }
          }
        }
      }
    }

    # Backend API
    rule {
      host = local.api_host

      http {
        path {
          path      = "/"
          path_type = "Prefix"

          backend {
            service {
              name = kubernetes_service.backend.metadata[0].name
              port {
                number = 3001
              }
            }
          }
        }
      }
    }

    # Ingest
    rule {
      host = local.ingest_host

      http {
        path {
          path      = "/"
          path_type = "Prefix"

          backend {
            service {
              name = kubernetes_service.ingest.metadata[0].name
              port {
                number = 3003
              }
            }
          }
        }
      }
    }

    # Python service
    rule {
      host = local.py_host

      http {
        path {
          path      = "/"
          path_type = "Prefix"

          backend {
            service {
              name = kubernetes_service.py.metadata[0].name
              port {
                number = 3004
              }
            }
          }
        }
      }
    }
  }

  depends_on = [kubernetes_namespace.mlop]
}
