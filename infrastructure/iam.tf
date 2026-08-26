# The instance's role, and nothing is attached to it that this deployment does
# not use. No managed policies — not even AmazonSSMManagedInstanceCore, which
# grants S3 and EC2 reads this instance has no business having. What Session
# Manager actually needs is the five actions at the bottom of the document.

data "aws_iam_policy_document" "app_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "${var.name_prefix}-app"
  assume_role_policy = data.aws_iam_policy_document.app_assume_role.json

  tags = {
    Name = "${var.name_prefix}-app"
  }
}

resource "aws_iam_instance_profile" "app" {
  name = "${var.name_prefix}-app"
  role = aws_iam_role.app.name

  tags = {
    Name = "${var.name_prefix}-app"
  }
}

data "aws_iam_policy_document" "app" {
  # The attachments bucket. Exactly the four operations the storage driver
  # makes: put on upload, get on download, delete on removal, and list for the
  # nightly orphan sweep. List is a bucket-level action and the other three are
  # object-level, which is why this is two statements rather than one — and
  # both stop at `local.attachments_prefix`, because that is the only place
  # the app writes and the only prefix it lists. Whatever else the bucket ever
  # holds is out of the instance's reach.
  statement {
    sid       = "AttachmentObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.attachments.arn}/${local.attachments_prefix}*"]
  }

  statement {
    sid       = "AttachmentBucket"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.attachments.arn]

    # `s3:prefix` is the request's Prefix parameter, which the sweep always
    # sends. A listing of the whole bucket has no prefix, fails this test, and
    # is refused — the app never makes one.
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${local.attachments_prefix}*"]
    }
  }

  # One parameter, by ARN. SecureString values are encrypted under the
  # AWS-managed `alias/aws/ssm` key, which SSM decrypts on the caller's behalf —
  # so there is no kms:Decrypt grant to add here, and adding one would be a
  # grant on a key this role never names.
  statement {
    sid       = "DatabaseUrlParameter"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.db_url.arn]
  }

  # Session Manager, which is how a person gets a shell on this box — there is
  # no SSH key and no port 22 anywhere in this stack. These five are the whole
  # minimum: the agent registers the instance, then opens the two channels a
  # session runs over. They take `*` because none of them is about a resource.
  statement {
    sid = "SessionManager"
    actions = [
      "ssm:UpdateInstanceInformation",
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }

  # Only when `app_image` names an ECR registry. A public image needs no
  # credential at all, and a permission that exists for an image nobody pulls
  # is a permission granted for nothing.
  dynamic "statement" {
    for_each = local.uses_ecr ? [1] : []

    content {
      sid       = "EcrAuthorizationToken"
      actions   = ["ecr:GetAuthorizationToken"]
      resources = ["*"] # The token is account-wide; there is no ARN to name.
    }
  }

  dynamic "statement" {
    for_each = local.uses_ecr ? [1] : []

    content {
      sid = "EcrPull"
      actions = [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchCheckLayerAvailability",
      ]
      resources = [local.ecr_repository_arn]
    }
  }
}

resource "aws_iam_role_policy" "app" {
  name   = "${var.name_prefix}-app"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}
