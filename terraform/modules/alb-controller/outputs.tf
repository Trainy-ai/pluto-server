output "helm_release_status" {
  description = "Status of the ALB controller Helm release"
  value       = helm_release.aws_load_balancer_controller.status
}
