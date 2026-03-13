# =============================================================================
# ALB Controller IRSA Role
# =============================================================================

data "aws_iam_policy_document" "alb_controller_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${var.oidc_provider_url}:sub"
      values   = ["system:serviceaccount:kube-system:aws-load-balancer-controller"]
    }

    condition {
      test     = "StringEquals"
      variable = "${var.oidc_provider_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "alb_controller" {
  name               = "${var.cluster_name}-alb-controller"
  assume_role_policy = data.aws_iam_policy_document.alb_controller_assume.json

  tags = {
    Terraform = "true"
  }
}

# ALB Controller IAM policy (from deployments/server/iam_policy.json)
resource "aws_iam_role_policy" "alb_controller" {
  name = "${var.cluster_name}-alb-controller-policy"
  role = aws_iam_role.alb_controller.id

  policy = file("${path.module}/alb_controller_policy.json")
}
