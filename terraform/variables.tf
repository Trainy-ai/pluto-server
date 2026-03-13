# =============================================================================
# AWS Configuration
# =============================================================================

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "cluster_name" {
  description = "Name of the EKS cluster"
  type        = string
  default     = "mlop"
}

# =============================================================================
# Networking (optional — omit to create a new VPC)
# =============================================================================

variable "vpc_id" {
  description = "Existing VPC ID. Leave empty to create a new VPC."
  type        = string
  default     = ""
}

variable "private_subnet_ids" {
  description = "Private subnet IDs (required if vpc_id is set)"
  type        = list(string)
  default     = []
}

variable "public_subnet_ids" {
  description = "Public subnet IDs (required if vpc_id is set)"
  type        = list(string)
  default     = []
}

# =============================================================================
# Domain & Routing
# =============================================================================

variable "domain" {
  description = "Root domain (Cloudflare-managed), e.g. example.com"
  type        = string
}

variable "app_subdomain" {
  description = "Subdomain for the frontend"
  type        = string
  default     = "app"
}

variable "api_subdomain" {
  description = "Subdomain for the backend API"
  type        = string
  default     = "api"
}

variable "ingest_subdomain" {
  description = "Subdomain for the ingest service"
  type        = string
  default     = "ingest"
}

variable "py_subdomain" {
  description = "Subdomain for the Python service"
  type        = string
  default     = "py"
}

# =============================================================================
# PostgreSQL (RDS — created automatically in the VPC)
# =============================================================================

variable "db_password" {
  description = "PostgreSQL master password"
  type        = string
  sensitive   = true
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.medium"
}

# =============================================================================
# ClickHouse (external — e.g. ClickHouse Cloud)
# =============================================================================

variable "clickhouse_url" {
  description = "ClickHouse HTTP URL (e.g. https://host:8443)"
  type        = string
}

variable "clickhouse_user" {
  description = "ClickHouse username"
  type        = string
  default     = "default"
}

variable "clickhouse_password" {
  description = "ClickHouse password"
  type        = string
  sensitive   = true
}

# =============================================================================
# Authentication
# =============================================================================

variable "better_auth_secret" {
  description = "Secret for session encryption (min 32 chars)"
  type        = string
  sensitive   = true
}

variable "github_client_id" {
  description = "GitHub OAuth app client ID"
  type        = string
  default     = ""
}

variable "github_client_secret" {
  description = "GitHub OAuth app client secret"
  type        = string
  sensitive   = true
  default     = ""
}

variable "google_client_id" {
  description = "Google OAuth client ID"
  type        = string
  default     = ""
}

variable "google_client_secret" {
  description = "Google OAuth client secret"
  type        = string
  sensitive   = true
  default     = ""
}

# =============================================================================
# Redis (in-cluster via Bitnami Helm)
# =============================================================================

variable "redis_password" {
  description = "Password for the in-cluster Redis instance"
  type        = string
  sensitive   = true
}

# =============================================================================
# Optional
# =============================================================================

variable "image_tag" {
  description = "Docker image tag for all mlop services"
  type        = string
  default     = "latest"
}

variable "resend_api_key" {
  description = "Resend API key for transactional email (optional)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "resend_from_email" {
  description = "From address for transactional email"
  type        = string
  default     = ""
}
