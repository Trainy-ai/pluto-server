variable "public_keys" {
  description = "CloudFront signing public keys (PEM) by name, e.g. { \"2026-09\" = file(\"cf.pub.pem\") }"
  type        = map(string)
}
