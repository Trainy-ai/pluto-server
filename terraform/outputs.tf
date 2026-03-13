output "configure_kubectl" {
  description = "Command to configure kubectl for the EKS cluster"
  value       = "aws eks update-kubeconfig --region ${var.aws_region} --name ${var.cluster_name}"
}

output "cluster_endpoint" {
  description = "EKS cluster API endpoint"
  value       = module.eks.cluster_endpoint
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint"
  value       = module.rds.endpoint
}

output "nat_gateway_eip" {
  description = "NAT gateway Elastic IP — add to ClickHouse Cloud IP Access List"
  value       = module.vpc.nat_gateway_eip
}

output "s3_bucket_name" {
  description = "S3 bucket name for file/artifact storage"
  value       = module.s3.storage_bucket
}

output "acm_validation_records" {
  description = "ACM certificate DNS validation records — add these CNAMEs to Cloudflare (grey-cloud / DNS only) during terraform apply"
  value       = module.acm.validation_records
}

output "cloudflare_dns_instructions" {
  description = "Steps to configure Cloudflare DNS and complete the deployment"
  value       = <<-EOT

    =========================================================================
    POST-DEPLOY SETUP
    =========================================================================

    1. Connect to the cluster:

       aws eks update-kubeconfig --region ${var.aws_region} --name ${var.cluster_name}

    2. Get the ALB DNS name:

       kubectl get ingress -n mlop mlop-ingress \
         -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'

    3. Create CNAME records in Cloudflare DNS (orange-cloud / proxied):

       ${var.app_subdomain}.${var.domain}     → <ALB hostname>
       ${var.api_subdomain}.${var.domain}     → <ALB hostname>
       ${var.ingest_subdomain}.${var.domain}  → <ALB hostname>
       ${var.py_subdomain}.${var.domain}      → <ALB hostname>

    4. Set Cloudflare SSL/TLS mode to "Full (strict)"

    5. Add NAT Gateway IP to ClickHouse Cloud IP Access List:
       ${module.vpc.nat_gateway_eip}

    6. Configure OAuth callback URLs:
       GitHub: https://${var.api_subdomain}.${var.domain}/api/auth/callback/github
       Google: https://${var.api_subdomain}.${var.domain}/api/auth/callback/google

    7. Health check URLs:
       Backend:  https://${var.api_subdomain}.${var.domain}/api/health
       Ingest:   https://${var.ingest_subdomain}.${var.domain}/health
       Frontend: https://${var.app_subdomain}.${var.domain}
       Python:   https://${var.py_subdomain}.${var.domain}/health

    =========================================================================

    USEFUL KUBECTL COMMANDS
    =========================================================================

    # View all pods
    kubectl get pods -n mlop

    # Check pod logs
    kubectl logs -n mlop deployment/mlop-backend
    kubectl logs -n mlop deployment/mlop-frontend
    kubectl logs -n mlop deployment/mlop-ingest
    kubectl logs -n mlop deployment/mlop-py

    # Restart a service
    kubectl rollout restart -n mlop deployment/mlop-backend

    # Check ingress status
    kubectl describe ingress -n mlop mlop-ingress

    # View init job logs (ClickHouse tables + DB migrations)
    kubectl logs -n mlop job/clickhouse-init
    kubectl logs -n mlop job/prisma-migrate

    # Shell into a running pod
    kubectl exec -it -n mlop deployment/mlop-backend -- sh

    # View all resources
    kubectl get all -n mlop

    =========================================================================
  EOT
}
