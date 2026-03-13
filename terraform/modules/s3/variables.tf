variable "cluster_name" {
  description = "Cluster name, used as prefix for S3 bucket and IAM user"
  type        = string
}

variable "aws_region" {
  description = "AWS region (used to construct the S3 endpoint URL)"
  type        = string
}
