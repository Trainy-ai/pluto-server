# =============================================================================
# S3 Bucket for file/artifact storage
# =============================================================================

resource "aws_s3_bucket" "storage" {
  bucket        = "${var.cluster_name}-mlop-storage"
  force_destroy = false

  tags = {
    Name = "${var.cluster_name}-mlop-storage"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "storage" {
  bucket = aws_s3_bucket.storage.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "storage" {
  bucket = aws_s3_bucket.storage.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# =============================================================================
# IAM User with scoped S3 access
# =============================================================================

resource "aws_iam_user" "s3" {
  name = "${var.cluster_name}-mlop-s3"

  tags = {
    Name = "${var.cluster_name}-mlop-s3"
  }
}

resource "aws_iam_user_policy" "s3" {
  name = "${var.cluster_name}-mlop-s3-access"
  user = aws_iam_user.s3.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
        ]
        Resource = [
          aws_s3_bucket.storage.arn,
          "${aws_s3_bucket.storage.arn}/*",
        ]
      }
    ]
  })
}

resource "aws_iam_access_key" "s3" {
  user = aws_iam_user.s3.name
}
