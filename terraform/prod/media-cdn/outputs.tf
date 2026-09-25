output "distribution_domain_name" {
  description = "CNAME target for pluto-media.trainy.ai in Cloudflare"
  value       = module.cdn.distribution_domain_name
}

output "distribution_id" {
  description = "CloudFront distribution id"
  value       = module.cdn.distribution_id
}

output "key_pair_ids" {
  description = "Set CLOUDFRONT_KEY_PAIR_ID to the id of the key the app signs with"
  value       = module.cdn.key_pair_ids
}
