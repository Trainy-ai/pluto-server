variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
}

variable "alb_controller_role_arn" {
  description = "IAM role ARN for the ALB controller service account"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}
