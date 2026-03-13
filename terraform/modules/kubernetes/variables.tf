# Domain
variable "domain" {
  type = string
}

variable "app_subdomain" {
  type = string
}

variable "api_subdomain" {
  type = string
}

variable "ingest_subdomain" {
  type = string
}

variable "py_subdomain" {
  type = string
}

variable "acm_certificate_arn" {
  description = "ACM wildcard certificate ARN for HTTPS"
  type        = string
}

# Images
variable "image_tag" {
  type    = string
  default = "latest"
}

# Database (constructed by RDS module)
variable "database_url" {
  type      = string
  sensitive = true
}

variable "database_direct_url" {
  type      = string
  sensitive = true
}

# ClickHouse (external — e.g. ClickHouse Cloud)
variable "clickhouse_url" {
  type = string
}

variable "clickhouse_user" {
  type    = string
  default = "default"
}

variable "clickhouse_password" {
  type      = string
  sensitive = true
}

# Storage
variable "storage_endpoint" {
  type = string
}

variable "storage_access_key_id" {
  type      = string
  sensitive = true
}

variable "storage_secret_access_key" {
  type      = string
  sensitive = true
}

variable "storage_bucket" {
  type = string
}

variable "storage_region" {
  type = string
}

# Auth
variable "better_auth_secret" {
  type      = string
  sensitive = true
}

variable "github_client_id" {
  type    = string
  default = ""
}

variable "github_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "google_client_id" {
  type    = string
  default = ""
}

variable "google_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}

# Redis
variable "redis_password" {
  type      = string
  sensitive = true
}

# Optional
variable "resend_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "resend_from_email" {
  type    = string
  default = ""
}
