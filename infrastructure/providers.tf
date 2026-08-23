terraform {
  # Cross-variable `validation` blocks (variables.tf uses one to keep `domain`
  # and `route53_zone_id` together) landed in 1.9.
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State stays local and git-ignored on purpose: this is one stack, owned by
  # one operator, and a starter that demanded a bootstrap bucket before it
  # could create anything would be a worse starter. README.md has the two-line
  # move to an S3 backend for the day a second person needs to run `apply`.
}

provider "aws" {
  region = var.region

  # Every resource this stack creates answers to these, so a console filter or
  # a Cost Explorer group-by finds the whole thing — including the pieces (a
  # route table, a security group rule) nobody would have tagged by hand.
  # `Project` follows `name_prefix` so two stacks in one account stay legible.
  default_tags {
    tags = merge({
      Project   = var.name_prefix
      ManagedBy = "terraform"
    }, var.tags)
  }
}
