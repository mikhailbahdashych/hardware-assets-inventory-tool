variable "region" {
  description = "AWS region for everything in this stack. The AMI is looked up here, so changing it needs nothing else."
  type        = string
  default     = "eu-central-1"
}

variable "name_prefix" {
  description = "Prefix on every resource name, and the value of the Project tag. Change it and a second copy of this stack can live in the same account."
  type        = string
  default     = "inventory"

  validation {
    # The narrowest rules any of the names built from this have to satisfy: an
    # S3 bucket prefix is lower-case only, and a load balancer name caps at 32
    # characters — 24 here leaves room for the longest suffix in the stack and
    # then some. Failing on the variable beats failing on the twentieth
    # resource of an apply.
    condition     = can(regex("^[a-z][a-z0-9-]{0,23}$", var.name_prefix))
    error_message = "name_prefix must start with a lower-case letter and hold only lower-case letters, digits and hyphens, at most 24 characters."
  }
}

variable "tags" {
  description = "Extra tags merged into the provider's default_tags, on top of Project and ManagedBy."
  type        = map(string)
  default     = {}
}

variable "vpc_cidr" {
  description = "The VPC's address range. The four /24 subnets are carved out of it."
  type        = string
  default     = "10.0.0.0/16"
}

variable "app_image" {
  description = "The container image the instance runs. A public registry needs no credentials; an ECR hostname makes the instance role and user_data grow a login (see iam.tf)."
  type        = string
  default     = "ghcr.io/mikhailbahdashych/hardware-assets-inventory-tool:latest"
}

variable "instance_type" {
  description = "EC2 instance type. The AMI's architecture is derived from it, so t4g.* and t3.* both just work."
  type        = string
  default     = "t4g.small"
}

variable "db_instance_class" {
  description = "RDS instance class. Must match the engine's supported classes; db.t4g.* is the cheap end."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "RDS storage in GB. Raising it is an in-place change; lowering it is not possible at all."
  type        = number
  default     = 20
}

variable "timezone" {
  description = "TZ for the container. The scheduled jobs run on wall-clock time, so this decides when 08:00 is."
  type        = string
  default     = "UTC"
}

variable "bucket_force_destroy" {
  description = "Whether `terraform destroy` may delete the attachments bucket with objects still in it. Off, because a bucket that empties itself on a typo is not a feature — turn it on deliberately before tearing the stack down."
  type        = bool
  default     = false
}

variable "domain" {
  description = "Public hostname to serve on. Null (the default) means the app answers on the instance's Elastic IP over plain HTTP; a name here creates an ACM certificate, an ALB and a Route53 record, and APP_URL becomes https://<domain>."
  type        = string
  default     = null
}

variable "route53_zone_id" {
  description = "The hosted zone `domain` lives in. Route53 is where both the certificate validation record and the A record are written, so the zone has to be here."
  type        = string
  default     = null

  validation {
    # Half the domain module is not a state anything can be applied from: a
    # certificate with nowhere to prove itself never validates, and an apply
    # would hang for the full 45 minutes before saying so.
    condition     = (var.domain == null) == (var.route53_zone_id == null)
    error_message = "Set both domain and route53_zone_id, or neither."
  }
}

locals {
  # The RDS root certificate bundle, at one path that has to be true in three
  # places: where user_data downloads it, where the container sees it mounted,
  # and what the connection string in SSM tells the driver to verify against.
  rds_ca_path = "/etc/inventory/rds-ca.pem"

  domain_enabled = var.domain != null

  # A private ECR image needs a `docker login` on the instance and four extra
  # ecr:* grants on its role; a public one (ghcr, docker hub) needs neither, so
  # both are gated on the image string actually naming an ECR registry rather
  # than on a flag somebody has to remember to set.
  ecr_match = regexall(
    "^(?P<account>[0-9]{12})\\.dkr\\.ecr\\.(?P<region>[a-z0-9-]+)\\.amazonaws\\.com/(?P<repository>[^:@]+)",
    var.app_image,
  )
  uses_ecr = length(local.ecr_match) > 0
  # Everything up to the first slash: what `docker login` is addressed to.
  ecr_registry = local.uses_ecr ? split("/", var.app_image)[0] : ""
  # The registry's own region, not var.region. They are usually the same, and
  # `get-login-password` against the wrong one hands back a token the registry
  # will not accept — which reads as a mysterious authentication failure rather
  # than as the cross-region pull it is.
  ecr_region = local.uses_ecr ? local.ecr_match[0].region : ""
  # The repository ARN, so the pull grants name one repository and not `*`.
  ecr_repository_arn = local.uses_ecr ? format(
    "arn:aws:ecr:%s:%s:repository/%s",
    local.ecr_match[0].region,
    local.ecr_match[0].account,
    local.ecr_match[0].repository,
  ) : ""
}
