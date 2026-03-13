provider "aws" {
  region = var.aws_region
}

# =============================================================================
# Data sources for existing resources
# =============================================================================

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

# =============================================================================
# VPC — created or imported
# =============================================================================

module "vpc" {
  source = "./modules/vpc"

  cluster_name       = var.cluster_name
  vpc_id             = var.vpc_id
  private_subnet_ids = var.private_subnet_ids
  public_subnet_ids  = var.public_subnet_ids
  availability_zones = data.aws_availability_zones.available.names
}

# =============================================================================
# EKS Cluster (Auto Mode)
# =============================================================================

module "eks" {
  source = "./modules/eks"

  cluster_name       = var.cluster_name
  private_subnet_ids = module.vpc.private_subnet_ids
  public_subnet_ids  = module.vpc.public_subnet_ids
  vpc_id             = module.vpc.vpc_id
}

# Configure kubernetes & helm providers from EKS outputs
provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_ca_certificate)

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", var.cluster_name, "--region", var.aws_region]
  }
}

provider "helm" {
  kubernetes {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_ca_certificate)

    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", var.cluster_name, "--region", var.aws_region]
    }
  }
}

# =============================================================================
# IAM Roles (ALB Controller IRSA)
# =============================================================================

module "iam" {
  source = "./modules/iam"

  cluster_name      = var.cluster_name
  oidc_provider_arn = module.eks.oidc_provider_arn
  oidc_provider_url = module.eks.oidc_provider_url
  account_id        = data.aws_caller_identity.current.account_id
}

# =============================================================================
# AWS Load Balancer Controller
# =============================================================================

module "alb_controller" {
  source = "./modules/alb-controller"

  cluster_name            = var.cluster_name
  alb_controller_role_arn = module.iam.alb_controller_role_arn
  vpc_id                  = module.vpc.vpc_id

  depends_on = [module.eks]
}

# =============================================================================
# RDS PostgreSQL (in-VPC, security group auto-wired to EKS)
# =============================================================================

module "rds" {
  source = "./modules/rds"

  cluster_name          = var.cluster_name
  vpc_id                = module.vpc.vpc_id
  private_subnet_ids    = module.vpc.private_subnet_ids
  eks_security_group_id = module.eks.cluster_primary_security_group_id
  db_password           = var.db_password
  db_instance_class     = var.db_instance_class

}

# =============================================================================
# S3 Bucket + IAM (auto-provisioned storage)
# =============================================================================

module "s3" {
  source = "./modules/s3"

  cluster_name = var.cluster_name
  aws_region   = var.aws_region
}

# =============================================================================
# ACM Wildcard Certificate (DNS-validated via Cloudflare)
# =============================================================================

module "acm" {
  source = "./modules/acm"

  domain = var.domain
}

# =============================================================================
# Kubernetes Resources (namespace, deployments, services, ingress, init jobs)
# =============================================================================

module "kubernetes" {
  source = "./modules/kubernetes"

  # Domain
  domain              = var.domain
  app_subdomain       = var.app_subdomain
  api_subdomain       = var.api_subdomain
  ingest_subdomain    = var.ingest_subdomain
  py_subdomain        = var.py_subdomain
  acm_certificate_arn = module.acm.certificate_arn

  # Images
  image_tag = var.image_tag

  # Database (from RDS module)
  database_url        = module.rds.database_url
  database_direct_url = module.rds.database_direct_url

  # ClickHouse (external)
  clickhouse_url      = var.clickhouse_url
  clickhouse_user     = var.clickhouse_user
  clickhouse_password = var.clickhouse_password

  # Storage (from S3 module)
  storage_endpoint          = module.s3.storage_endpoint
  storage_access_key_id     = module.s3.storage_access_key_id
  storage_secret_access_key = module.s3.storage_secret_access_key
  storage_bucket            = module.s3.storage_bucket
  storage_region            = module.s3.storage_region

  # Auth
  better_auth_secret   = var.better_auth_secret
  github_client_id     = var.github_client_id
  github_client_secret = var.github_client_secret
  google_client_id     = var.google_client_id
  google_client_secret = var.google_client_secret

  # Redis
  redis_password = var.redis_password

  # Optional
  resend_api_key    = var.resend_api_key
  resend_from_email = var.resend_from_email

  depends_on = [module.alb_controller, module.acm]
}
