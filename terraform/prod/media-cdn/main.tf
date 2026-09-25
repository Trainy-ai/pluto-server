# Prod media CDN: pluto-media.trainy.ai in front of the trakker-trainy bucket
# (shared by prod and dev Pluto on the trakker EKS cluster). Prod itself is
# not managed by the self-hosted root in terraform/; this root only owns the
# CDN and the bucket policy.

module "cdn" {
  source = "../../modules/cdn"

  name        = "pluto-media"
  bucket_name = "trakker-trainy"
  domain_name = "pluto-media.trainy.ai"
  # Existing *.trainy.ai wildcard (also used by the pluto ALB).
  acm_certificate_arn  = "arn:aws:acm:us-east-1:221986592633:certificate/3b3fa85b-d518-49ea-85e6-adac2cd79771"
  public_keys          = var.public_keys
  cors_allowed_origins = ["https://pluto.trainy.ai", "https://pluto-dev.trainy.ai"]

  # The bucket's pre-existing policy, kept verbatim.
  existing_bucket_policy_json = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = ["arn:aws:s3:::trakker-trainy", "arn:aws:s3:::trakker-trainy/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}
