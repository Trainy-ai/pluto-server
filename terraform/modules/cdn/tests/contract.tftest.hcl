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
  name                 = "pluto-media"
  bucket_name          = "trakker-trainy"
  domain_name          = "pluto-media.trainy.ai"
  acm_certificate_arn  = "arn:aws:acm:us-east-1:221986592633:certificate/example"
  cors_allowed_origins = ["https://pluto.trainy.ai"]
  public_keys = {
    "test" = "-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----\n"
  }
  existing_bucket_policy_json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"DenyInsecureTransport\",\"Effect\":\"Deny\",\"Principal\":\"*\",\"Action\":\"s3:*\",\"Resource\":\"*\"}]}"
}

run "cdn_module_contract" {
  command = plan

  assert {
    condition = (
      tolist(aws_cloudfront_distribution.storage.aliases) == tolist(["pluto-media.trainy.ai"]) &&
      aws_cloudfront_distribution.storage.viewer_certificate[0].minimum_protocol_version == "TLSv1.2_2021" &&
      aws_cloudfront_distribution.storage.default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https"
    )
    error_message = "Distribution must serve pluto-media.trainy.ai over TLS 1.2+ only."
  }

  assert {
    condition = (
      aws_cloudfront_response_headers_policy.cors.cors_config[0].origin_override == true &&
      tolist(aws_cloudfront_response_headers_policy.cors.cors_config[0].access_control_allow_origins[0].items) == tolist(["https://pluto.trainy.ai"])
    )
    error_message = "CORS must be added at the edge for exactly the configured origins."
  }

  assert {
    condition     = length(aws_cloudfront_distribution.storage.default_cache_behavior[0].trusted_key_groups) == 1
    error_message = "Every request must require a signed URL (trusted key group)."
  }

  assert {
    condition = anytrue([
      for s in jsondecode(aws_s3_bucket_policy.storage.policy).Statement :
      try(
        s.Sid == "DenyInsecureTransport" && s.Effect == "Deny",
        false,
      )
    ])
    error_message = "The bucket's existing DenyInsecureTransport statement must be preserved."
  }

  assert {
    condition = anytrue([
      for s in jsondecode(aws_s3_bucket_policy.storage.policy).Statement :
      try(
        s.Sid == "AllowCloudFrontRead" &&
        s.Action == "s3:GetObject" &&
        s.Condition.StringEquals["AWS:SourceArn"] == "arn:aws:cloudfront::221986592633:distribution/EEXAMPLE",
        false,
      )
    ])
    error_message = "CloudFront read access must be scoped to this distribution only."
  }
}
