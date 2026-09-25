# Prod media CDN (`pluto-media.trainy.ai`)

CloudFront in front of the `trakker-trainy` bucket, used by prod and dev Pluto
on the trakker EKS cluster. The web backend signs download URLs with a
CloudFront key pair (`web/server/lib/s3.ts`), so:

- **Performance:** files are served from CloudFront's edge cache, and a 5-day
  signed URL stays stable for 24h (memoized), so browsers cache it too.
- **No IAM access key:** S3 presigned URLs signed with IRSA credentials die
  when the ~1h STS credentials expire. CloudFront signatures don't depend on
  IAM credentials, which lets prod drop the static `trakker-s3` key.

Uploads are unchanged (S3 presigned PUTs from ingest).

This root only owns the CDN and the bucket policy. It uses
`terraform/modules/cdn`; the self-hosted stack in `terraform/` is separate.

## One-time: state bucket

The backend is S3 (`backend.hcl.example`). Create the bucket once, by hand:

```bash
B=<state-bucket>
aws s3api create-bucket --bucket $B --region us-east-1
aws s3api put-bucket-versioning --bucket $B --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket $B \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket $B --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

## Rollout

1. **Generate the signing key pair locally.** The private key never goes
   through Terraform or git.
   ```bash
   openssl genrsa -out cf.pem 2048
   openssl rsa -pubout -in cf.pem -out cf.pub.pem
   ```
2. **Apply.** Put `cf.pub.pem` in `terraform.tfvars` (see the example), then:
   ```bash
   cp backend.hcl.example backend.hcl   # fill in the state bucket
   terraform init -backend-config=backend.hcl
   terraform plan    # expect: distribution, OAC, key, key group, CORS policy, bucket policy
   terraform apply
   ```
   The bucket policy is replaced as a whole; the plan must show both
   `DenyInsecureTransport` (pre-existing) and `AllowCloudFrontRead`.
3. **DNS (Cloudflare).** CNAME `pluto-media` → `terraform output
   distribution_domain_name`, **DNS only** (grey cloud). The `*.trainy.ai`
   ACM certificate already covers the name.
4. **Dev first.** Add to `mlop-config-dev`:
   `STORAGE_CDN_URL=https://pluto-media.trainy.ai` and
   `CLOUDFRONT_KEY_PAIR_ID=<terraform output key_pair_ids>`; add
   `CLOUDFRONT_PRIVATE_KEY` (contents of `cf.pem`) to `mlop-secrets-noaws`.
   Restart `backend-dev` and check that run media loads on pluto-dev and that
   file URLs carry `Key-Pair-Id=`. All three variables must be set together;
   the backend refuses to start with a partial config.
5. **Prod.** Same variables in `mlop-config` / `mlop-secrets`; restart
   `backend`. Verify media loads on pluto.trainy.ai.
6. **Drop the static key.** Once prod serves media via CloudFront, remove
   `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` from `mlop-secrets`
   (the backend and ingest then use the `trakker-s3-irsa` role), restart, verify
   uploads and media, then deactivate the `trakker-s3` IAM user's access key.
   That clears the Vanta 90-day access-key finding.

## Safety: what this root can and cannot delete

- **The bucket itself is not managed here** (read via a data source), so no
  command in this root can delete `trakker-trainy` or its objects. The bucket
  is also versioned and replicated to `trakker-trainy-dr`.
- **The bucket policy is managed here and has `prevent_destroy`.** S3 bucket
  policies are replaced whole, so destroying the resource would delete the
  pre-existing `DenyInsecureTransport` statement too; Terraform refuses any
  plan that would. To retire the CDN: restore the bucket's original policy by
  hand, `terraform state rm module.cdn.aws_s3_bucket_policy.storage`, then
  destroy the rest.
- Requires Terraform >= 1.11 (the tests use `override_during`).

## Key rotation

Add a second entry to `public_keys` and apply; switch
`CLOUDFRONT_KEY_PAIR_ID` / `CLOUDFRONT_PRIVATE_KEY` to the new pair and
restart; after the memoized URLs age out (5 days), remove the old entry and
apply. The key group trusts every listed key, so there is no downtime.

Signed URLs use CloudFront canned policies (RSA-SHA1 signatures, the scheme
CloudFront supports for signed URLs).
