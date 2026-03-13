# =============================================================================
# ACM Wildcard Certificate with DNS Validation
# =============================================================================
# Creates *.domain certificate. Terraform will pause at the validation resource
# until the user adds the CNAME record to Cloudflare (printed in plan output).
# Once validated, the certificate auto-renews — no future maintenance needed.
# =============================================================================

resource "aws_acm_certificate" "wildcard" {
  domain_name       = "*.${var.domain}"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "mlop-wildcard-${var.domain}"
  }
}

resource "aws_acm_certificate_validation" "wildcard" {
  certificate_arn = aws_acm_certificate.wildcard.arn

  # Terraform blocks here until the DNS validation CNAME is added and AWS verifies it
}
