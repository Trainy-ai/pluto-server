variable "name" {
  description = "Name prefix for the distribution's key group, public keys, and policies"
  type        = string
}

variable "bucket_name" {
  description = "Existing S3 bucket that stores run files (the CloudFront origin)"
  type        = string
}

variable "domain_name" {
  description = "Custom hostname for the distribution, e.g. pluto-media.example.com"
  type        = string
}

variable "acm_certificate_arn" {
  description = "ACM certificate covering domain_name; CloudFront requires it in us-east-1"
  type        = string

  validation {
    condition     = can(regex("^arn:aws:acm:us-east-1:", var.acm_certificate_arn))
    error_message = "CloudFront only accepts ACM certificates from us-east-1."
  }
}

variable "public_keys" {
  description = <<-EOT
    CloudFront public keys (PEM) trusted to sign URLs, keyed by a stable name.
    The private keys never go through Terraform. Rotate by adding a new entry,
    switching the app to the new key pair id, then removing the old entry.
  EOT
  type        = map(string)

  validation {
    condition     = length(var.public_keys) > 0
    error_message = "At least one public key is required to sign URLs."
  }
}

variable "cors_allowed_origins" {
  description = "Browser origins allowed to fetch files (the web app URLs)"
  type        = list(string)
}

variable "existing_bucket_policy_json" {
  description = <<-EOT
    The bucket's current policy document (JSON), if any. aws_s3_bucket_policy
    replaces the whole policy, so pre-existing statements must be passed in to
    be kept alongside the CloudFront read grant.
  EOT
  type        = string
  default     = null
}

variable "price_class" {
  description = "CloudFront price class (edge locations used)"
  type        = string
  default     = "PriceClass_100"
}
