terraform {
  required_version = ">= 1.11.0" # tests use override_during

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # State bucket is created once by hand; see README.md. Values in backend.hcl.
  backend "s3" {}
}

provider "aws" {
  region              = "us-east-1"
  allowed_account_ids = ["221986592633"]

  default_tags {
    tags = {
      managed-by = "terraform"
      repo       = "server-private/terraform/prod/media-cdn"
    }
  }
}
