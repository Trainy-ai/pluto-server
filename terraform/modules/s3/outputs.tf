output "storage_endpoint" {
  description = "S3 endpoint URL"
  value       = "https://s3.${var.aws_region}.amazonaws.com"
}

output "storage_access_key_id" {
  description = "IAM access key ID for S3 access"
  value       = aws_iam_access_key.s3.id
}

output "storage_secret_access_key" {
  description = "IAM secret access key for S3 access"
  value       = aws_iam_access_key.s3.secret
  sensitive   = true
}

output "storage_bucket" {
  description = "S3 bucket name"
  value       = aws_s3_bucket.storage.id
}

output "storage_region" {
  description = "S3 bucket region"
  value       = var.aws_region
}
