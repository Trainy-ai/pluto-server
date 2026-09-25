output "distribution_id" {
  description = "CloudFront distribution id (for cache invalidations)"
  value       = aws_cloudfront_distribution.storage.id
}

output "distribution_domain_name" {
  description = "CloudFront hostname; point the domain_name CNAME here"
  value       = aws_cloudfront_distribution.storage.domain_name
}

output "key_pair_ids" {
  description = "CloudFront public key ids by name; the app's CLOUDFRONT_KEY_PAIR_ID is one of these"
  value       = { for name, key in aws_cloudfront_public_key.signing : name => key.id }
}

output "key_group_id" {
  description = "Key group trusted by the distribution"
  value       = aws_cloudfront_key_group.signing.id
}

output "aliases" {
  description = "Hostnames the distribution serves"
  value       = aws_cloudfront_distribution.storage.aliases
}

output "bucket_policy_json" {
  description = "Merged bucket policy (pre-existing statements + CloudFront read grant)"
  value       = aws_s3_bucket_policy.storage.policy
}
