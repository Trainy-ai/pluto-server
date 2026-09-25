# =============================================================================
# CloudFront CDN for file downloads
# =============================================================================
#
# Serves an existing private S3 bucket through CloudFront. Every request must
# carry a CloudFront signed URL (trusted_key_groups); the web backend signs
# them with a CloudFront key pair, not IAM credentials, so download links can
# stay valid for days without a long-lived IAM access key.

data "aws_s3_bucket" "storage" {
  bucket = var.bucket_name
}

# Excludes the query string from the cache key, so every signed variant of a
# URL (different Expires/Signature) shares one edge cache entry.
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_origin_access_control" "storage" {
  name                              = "${var.name}-storage"
  description                       = "CloudFront access to ${var.bucket_name}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_public_key" "signing" {
  for_each = var.public_keys

  name        = "${var.name}-${each.key}"
  comment     = "Signs ${var.domain_name} download URLs"
  encoded_key = each.value
}

resource "aws_cloudfront_key_group" "signing" {
  name    = "${var.name}-signing"
  comment = "Keys trusted to sign ${var.domain_name} URLs"
  items   = [for key in aws_cloudfront_public_key.signing : key.id]
}

# CORS is added at the edge (origin_override) rather than forwarded from S3,
# so a response cached by a plain <img> request still carries CORS headers
# when a later fetch() hits the same cache entry.
resource "aws_cloudfront_response_headers_policy" "cors" {
  name    = "${var.name}-cors"
  comment = "CORS for ${var.domain_name}"

  cors_config {
    access_control_allow_credentials = false
    access_control_max_age_sec       = 3600
    origin_override                  = true

    access_control_allow_headers {
      items = ["*"]
    }

    access_control_allow_methods {
      items = ["GET", "HEAD", "OPTIONS"]
    }

    access_control_allow_origins {
      items = var.cors_allowed_origins
    }

    access_control_expose_headers {
      items = ["ETag", "Content-Length", "Content-Type"]
    }
  }
}

resource "aws_cloudfront_distribution" "storage" {
  enabled         = true
  is_ipv6_enabled = true
  http_version    = "http2and3"
  price_class     = var.price_class
  aliases         = [var.domain_name]
  comment         = "${var.name}: signed downloads from ${var.bucket_name}"

  origin {
    origin_id                = "s3-${var.bucket_name}"
    domain_name              = data.aws_s3_bucket.storage.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.storage.id
  }

  default_cache_behavior {
    target_origin_id           = "s3-${var.bucket_name}"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.cors.id
    trusted_key_groups         = [aws_cloudfront_key_group.signing.id]
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# =============================================================================
# Bucket policy: CloudFront read grant + pre-existing statements
# =============================================================================

locals {
  # Built with jsonencode rather than aws_iam_policy_document so the merged
  # policy is plain HCL (no provider round-trip) and assertable in tests.
  cloudfront_read_statement = {
    Sid       = "AllowCloudFrontRead"
    Effect    = "Allow"
    Principal = { Service = "cloudfront.amazonaws.com" }
    Action    = "s3:GetObject"
    Resource  = "${data.aws_s3_bucket.storage.arn}/*"
    Condition = {
      StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.storage.arn }
    }
  }

  existing_statements = var.existing_bucket_policy_json == null ? [] : jsondecode(var.existing_bucket_policy_json).Statement
}

resource "aws_s3_bucket_policy" "storage" {
  bucket = data.aws_s3_bucket.storage.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = concat(local.existing_statements, [local.cloudfront_read_statement])
  })

  # The bucket predates this module and its policy carries statements this
  # module doesn't own (existing_bucket_policy_json). Destroying the resource
  # deletes the whole policy, so refuse any plan that would; to retire the
  # CDN, first restore the bucket's own policy and `terraform state rm` this.
  lifecycle {
    prevent_destroy = true
  }
}
