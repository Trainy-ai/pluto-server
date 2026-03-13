# mlop Self-Hosted — Terraform Deployment

Deploy mlop on AWS with a single `terraform apply`. This module provisions a production-ready stack on EKS with all infrastructure managed automatically.

## What Terraform creates automatically

- **VPC** with public/private subnets + NAT gateway (or bring-your-own VPC)
- **EKS cluster** (Auto Mode — no node groups to manage)
- **RDS PostgreSQL 16** (private subnets, security group auto-wired to EKS)
- **S3 bucket + IAM user** with scoped credentials for file/artifact storage
- **ACM wildcard certificate** (`*.yourdomain.com`) with DNS validation — auto-renews forever
- **In-cluster Redis** (Bitnami Helm chart, 1Gi persistent volume)
- **ALB Ingress Controller** with host-based routing
- **All 4 mlop services** (backend, frontend, ingest, py) as K8s Deployments
- **Init jobs**: ClickHouse table creation + Prisma database migration
- `SELF_HOSTED=true` — all orgs get PRO-level access with no usage limits

## What you must provide

### ClickHouse Cloud

A ClickHouse Cloud instance (or any ClickHouse HTTP-compatible endpoint).

- `clickhouse_url` — HTTP URL (e.g. `https://your-instance.clickhouse.cloud:8443`)
- `clickhouse_user` — username (default: `default`)
- `clickhouse_password` — password

After `terraform apply`, add the NAT gateway IP (from `terraform output nat_gateway_eip`) to your ClickHouse Cloud service's **IP Access List**.

### Domain (Cloudflare-managed)

A domain managed by Cloudflare. After apply, create 4 CNAME records pointing to the ALB hostname (printed in the post-deploy instructions output).

### Auth secrets

- `better_auth_secret` — random string, 32+ characters
- `github_client_id` / `github_client_secret` — optional, for GitHub OAuth
- `google_client_id` / `google_client_secret` — optional, for Google OAuth

### Passwords

- `db_password` — RDS PostgreSQL master password
- `redis_password` — in-cluster Redis password

## Quick start

```bash
# 1. Copy and fill in the example config
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

# 2. Initialize and apply
terraform init
terraform apply
# ⚠️  Apply will PAUSE waiting for ACM certificate validation.
# When you see "Still creating..." on the ACM validation resource,
# open the AWS ACM console (or run the command below) to get the
# DNS validation CNAME, then add it to Cloudflare (grey-cloud / DNS only).
# Apply will automatically resume once AWS validates the record (~2-5 min).
#
#   aws acm list-certificates --query 'CertificateSummaryList[?DomainName==`*.yourdomain.com`].CertificateArn' --output text
#   aws acm describe-certificate --certificate-arn <ARN> --query 'Certificate.DomainValidationOptions[0].ResourceRecord'

# 3. Configure kubectl
$(terraform output -raw configure_kubectl)

# 4. Follow the post-deploy instructions
terraform output cloudflare_dns_instructions
```

## Post-apply steps

During `terraform apply`, the ACM certificate is created and Terraform pauses waiting for DNS validation. Add the validation CNAME record shown in the output to Cloudflare (grey-cloud / DNS only), then apply continues automatically once AWS validates the certificate.

1. **Add ACM validation CNAME** to Cloudflare during `terraform apply` (printed in plan output)
2. **Get ALB hostname**: `kubectl get ingress -n mlop mlop-ingress -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'`
3. **Create Cloudflare CNAME records** (orange-cloud / proxied) for `app`, `api`, `ingest`, and `py` subdomains → ALB hostname
4. **Set Cloudflare SSL/TLS mode** to "Full (strict)"
5. **Add NAT Gateway IP** to ClickHouse Cloud IP Access List
6. **Configure OAuth callback URLs** (if using GitHub/Google OAuth):
   - GitHub: `https://api.yourdomain.com/api/auth/callback/github`
   - Google: `https://api.yourdomain.com/api/auth/callback/google`

## Module reference

| Module | Purpose | Key resources |
|--------|---------|---------------|
| `modules/vpc` | Networking | VPC, subnets, NAT gateway, internet gateway |
| `modules/eks` | Compute | EKS cluster (Auto Mode), OIDC provider |
| `modules/iam` | Permissions | ALB Controller IRSA role |
| `modules/alb-controller` | Ingress | AWS Load Balancer Controller (Helm) |
| `modules/rds` | Database | RDS PostgreSQL 16, security group |
| `modules/s3` | Storage | S3 bucket, IAM user, access key |
| `modules/acm` | TLS certificate | ACM wildcard certificate, DNS validation |
| `modules/kubernetes` | Application | Namespace, deployments, services, ingress, Redis, init jobs |

## Variables reference

See [`terraform.tfvars.example`](terraform.tfvars.example) for all configurable variables with descriptions.
