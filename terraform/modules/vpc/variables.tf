variable "cluster_name" {
  description = "EKS cluster name (used for subnet tagging)"
  type        = string
}

variable "vpc_id" {
  description = "Existing VPC ID. Leave empty to create a new VPC."
  type        = string
  default     = ""
}

variable "private_subnet_ids" {
  description = "Existing private subnet IDs"
  type        = list(string)
  default     = []
}

variable "public_subnet_ids" {
  description = "Existing public subnet IDs"
  type        = list(string)
  default     = []
}

variable "availability_zones" {
  description = "List of availability zones"
  type        = list(string)
}
