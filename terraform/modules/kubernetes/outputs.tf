output "namespace" {
  description = "Kubernetes namespace for mlop services"
  value       = local.namespace
}

output "ingress_name" {
  description = "Name of the ALB ingress resource"
  value       = kubernetes_ingress_v1.mlop.metadata[0].name
}
