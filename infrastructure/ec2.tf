# One instance, running the same container image the docker-compose deployment
# runs. Nothing about the app changes here — it is the environment it boots with
# that makes this the full-scale story: rows in RDS, attachments in S3.

# The architecture comes from the instance type rather than from a second
# variable somebody has to keep in step: swap `instance_type` to a t3 and the
# AMI lookup follows it to x86_64 on the same apply.
data "aws_ec2_instance_type" "app" {
  instance_type = var.instance_type
}

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name = "name"
    # `al2023-ami-2023*` and not `al2023-ami-*`, so this never picks up the
    # minimal variant (`al2023-ami-minimal-2023…`), which ships no SSM agent.
    values = ["al2023-ami-2023*-${local.instance_architecture}"]
  }
}

locals {
  # `supported_architectures` can list i386 beside x86_64 on older families and
  # there is no 32-bit AL2023, so this asks the one question that matters
  # rather than taking element zero and hoping.
  instance_architecture = contains(data.aws_ec2_instance_type.app.supported_architectures, "arm64") ? "arm64" : "x86_64"

  # APP_URL has to be exactly the address a browser types. The app compares
  # every mutating request's Origin against it and answers 403 on a mismatch,
  # so a wrong value here is not a cosmetic thing: it is an instance where
  # nothing saves, starting with /setup.
  app_url = local.domain_enabled ? "https://${var.domain}" : "http://${aws_eip.app.public_ip}"
}

# Allocated before the instance, because user_data has to be able to name it.
# That ordering is also why aws_eip_association exists separately below: giving
# the EIP an `instance` here would make the two resources depend on each other.
resource "aws_eip" "app" {
  domain = "vpc"

  # An EIP created before its gateway is attached can end up unroutable.
  depends_on = [aws_internet_gateway.main]

  tags = {
    Name = var.name_prefix
  }
}

resource "aws_eip_association" "app" {
  allocation_id = aws_eip.app.id
  instance_id   = aws_instance.app.id
}

resource "aws_security_group" "app" {
  name        = "${var.name_prefix}-app"
  description = "HTTP to the application instance"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${var.name_prefix}-app"
  }
}

# Without the domain module the instance is the front door, so the world
# reaches it directly. With it, dns.tf adds a rule for the load balancer's
# security group instead and these two are not created at all.
resource "aws_vpc_security_group_ingress_rule" "app_http" {
  count = local.domain_enabled ? 0 : 1

  security_group_id = aws_security_group.app.id
  description       = "HTTP from anywhere"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "app_https" {
  count = local.domain_enabled ? 0 : 1

  security_group_id = aws_security_group.app.id
  # Nothing listens here yet. It is open because the usual next step for an
  # instance on a bare IP is a TLS terminator on the box itself (docs/
  # deployment.md's Caddy block), and a closed port is the thing people spend
  # an afternoon on afterwards. Delete this rule if that is not your plan.
  description = "HTTPS from anywhere, for a TLS terminator on the instance"
  cidr_ipv4   = "0.0.0.0/0"
  ip_protocol = "tcp"
  from_port   = 443
  to_port     = 443
}

resource "aws_vpc_security_group_egress_rule" "app_all" {
  security_group_id = aws_security_group.app.id
  description       = "Everything out: the image, SSM, S3, RDS"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_instance" "app" {
  ami           = data.aws_ami.al2023.id
  instance_type = var.instance_type
  subnet_id     = aws_subnet.public[0].id

  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name

  user_data = templatefile("${path.module}/user_data.sh.tpl", {
    region             = var.region
    app_image          = var.app_image
    ecr_registry       = local.ecr_registry
    ecr_region         = local.ecr_region
    ssm_parameter_name = aws_ssm_parameter.db_url.name
    rds_ca_path        = local.rds_ca_path
    s3_bucket          = aws_s3_bucket.attachments.bucket
    app_url            = local.app_url
    timezone           = var.timezone
    public_ip          = aws_eip.app.public_ip
    # Only behind the load balancer. Set on an instance with nothing in front
    # of it, X-Forwarded-For becomes a header any client writes for itself —
    # and the sign-in rate limits are keyed on what it says.
    trust_proxy = local.domain_enabled
  })

  # The image tag is read by user_data at boot, so a new tag is a new script,
  # and a new script has to reach a booting instance. Replacement is the honest
  # answer: the data is in RDS and S3, so the instance is disposable.
  user_data_replace_on_change = true

  root_block_device {
    # Only the image, the container's logs and the RDS bundle live here.
    volume_size = 30
    volume_type = "gp3"
    encrypted   = true

    tags = {
      Name = "${var.name_prefix}-app"
    }
  }

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
    # Two hops, not the default one. The app reads its S3 credentials from the
    # instance role through IMDS — from inside a container on Docker's bridge
    # network, which is one hop further than the host. At the default the
    # credential lookup times out and every attachment upload fails.
    http_put_response_hop_limit = 2
  }

  # The parameter is already a dependency — user_data interpolates its name.
  # The policy that makes reading it allowed is not: nothing here refers to it,
  # and without this the instance can be booting and fetching before the grant
  # exists, which fails as an AccessDenied nobody would think to look for.
  depends_on = [aws_iam_role_policy.app]

  tags = {
    Name = "${var.name_prefix}-app"
  }
}
