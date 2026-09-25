# Mocked ARNs must be well-formed: the AWS provider validates ARN arguments
# wired between resources. override_during = plan makes the mocked values
# known at plan time, so the runs below are plan-only: nothing is applied,
# so nothing needs destroying (the bucket policy has prevent_destroy).
mock_provider "aws" {
  override_during = plan

  mock_data "aws_s3_bucket" {
    defaults = {
      id                          = "trakker-trainy"
      arn                         = "arn:aws:s3:::trakker-trainy"
      bucket_regional_domain_name = "trakker-trainy.s3.us-east-1.amazonaws.com"
    }
  }
  mock_data "aws_cloudfront_cache_policy" {
    defaults = { id = "658327ea-f89d-4fab-a63d-7e88639e58f6" }
  }
  mock_resource "aws_cloudfront_distribution" {
    defaults = {
      arn         = "arn:aws:cloudfront::221986592633:distribution/EEXAMPLE"
      domain_name = "d111111abcdef8.cloudfront.net"
    }
  }
}

variables {
  public_keys = {
    "test" = "-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----\n"
  }
}

run "media_cdn_prod_wiring" {
  command = plan

  assert {
    condition = (
      module.cdn.distribution_domain_name == "d111111abcdef8.cloudfront.net" &&
      tolist(module.cdn.aliases) == tolist(["pluto-media.trainy.ai"])
    )
    error_message = "Prod must serve pluto-media.trainy.ai and expose the CNAME target for Cloudflare."
  }

  assert {
    condition = anytrue([
      for s in jsondecode(module.cdn.bucket_policy_json).Statement :
      try(
        s.Sid == "DenyInsecureTransport" && s.Effect == "Deny" &&
        s.Condition.Bool["aws:SecureTransport"] == "false",
        false,
      )
    ])
    error_message = "trakker-trainy's existing DenyInsecureTransport statement must be preserved."
  }

  assert {
    condition = anytrue([
      for s in jsondecode(module.cdn.bucket_policy_json).Statement :
      try(
        s.Sid == "AllowCloudFrontRead" &&
        s.Condition.StringEquals["AWS:SourceArn"] == "arn:aws:cloudfront::221986592633:distribution/EEXAMPLE",
        false,
      )
    ])
    error_message = "CloudFront read access must be scoped to this distribution only."
  }
}
