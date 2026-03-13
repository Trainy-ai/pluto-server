output "vpc_id" {
  description = "VPC ID"
  value       = local.create_vpc ? module.vpc.vpc_id : var.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = local.create_vpc ? module.vpc.private_subnets : var.private_subnet_ids
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = local.create_vpc ? module.vpc.public_subnets : var.public_subnet_ids
}

output "nat_gateway_eip" {
  description = "NAT Gateway Elastic IP (for allowlisting in ClickHouse/RDS)"
  value       = local.create_vpc ? try(module.vpc.nat_public_ips[0], "N/A") : "See your existing VPC NAT gateway"
}
