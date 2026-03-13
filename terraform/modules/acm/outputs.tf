output "certificate_arn" {
  description = "Validated ACM wildcard certificate ARN"
  value       = aws_acm_certificate_validation.wildcard.certificate_arn
}

output "validation_records" {
  description = "DNS validation records — add these as CNAMEs in Cloudflare (grey-cloud / DNS only)"
  value = [
    for dvo in aws_acm_certificate.wildcard.domain_validation_options : {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  ]
}
