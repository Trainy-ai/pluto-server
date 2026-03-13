output "database_url" {
  description = "PostgreSQL connection URL"
  value       = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.mlop.endpoint}/${var.db_name}"
  sensitive   = true
}

output "database_direct_url" {
  description = "PostgreSQL direct connection URL (same as database_url for RDS)"
  value       = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.mlop.endpoint}/${var.db_name}"
  sensitive   = true
}

output "endpoint" {
  description = "RDS endpoint (host:port)"
  value       = aws_db_instance.mlop.endpoint
}
