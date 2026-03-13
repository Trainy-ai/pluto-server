module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = var.cluster_name
  cluster_version = "1.34"

  vpc_id     = var.vpc_id
  subnet_ids = var.private_subnet_ids

  # EKS Auto Mode — handles node provisioning, scaling, OS updates automatically
  cluster_compute_config = {
    enabled    = true
    node_pools = ["general-purpose", "system"]
  }

  # Endpoint access
  cluster_endpoint_public_access  = true
  cluster_endpoint_private_access = true

  # OIDC provider for IRSA
  enable_irsa = true

  # Allow current caller full admin access
  enable_cluster_creator_admin_permissions = true

  tags = {
    Terraform   = "true"
    Environment = "production"
  }
}
