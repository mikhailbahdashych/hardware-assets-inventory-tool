# PostgreSQL, private, and reachable only from the instance.
#
# The app decides its engine from `DATABASE_URL` alone, so everything this file
# exists to produce is one connection string — written to an SSM SecureString
# that the instance reads at boot with its role. The password is generated
# here, and this is the only stack that ever sees it in the clear.

resource "aws_security_group" "db" {
  name        = "${var.name_prefix}-db"
  description = "PostgreSQL, from the application instance only"
  vpc_id      = aws_vpc.main.id

  # No egress rule anywhere in this file, and that is the point: a security
  # group Terraform creates has AWS's allow-all outbound rule revoked, and a
  # database answering queries needs no outbound of its own — the replies to an
  # accepted connection are not egress.

  tags = {
    Name = "${var.name_prefix}-db"
  }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL from the application instance"
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.name_prefix}-db"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "${var.name_prefix}-db"
  }
}

resource "random_password" "db" {
  length = 32
  # No punctuation, so the password can sit in a URL without percent-encoding —
  # and so nothing downstream (an env file, a shell, a heredoc) has to be
  # careful with it. 32 alphanumerics is ~190 bits; the characters are not what
  # this is short of.
  special = false
}

resource "aws_db_instance" "main" {
  identifier = "${var.name_prefix}-db"

  engine = "postgres"
  # Major version only: the provider treats a configured prefix as satisfied by
  # whatever minor RDS is actually running, so a minor upgrade is not a diff.
  engine_version = "17"

  instance_class    = var.db_instance_class
  allocated_storage = var.db_allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = "inventory"
  username = "inventory"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false

  backup_retention_period = 7
  copy_tags_to_snapshot   = true

  # This is a self-hosted starter, and the first thing anyone does with a
  # starter is destroy it. Both of these are the production settings inverted:
  # README.md ("Before you call it production") is where to turn them back.
  deletion_protection = false
  skip_final_snapshot = true

  # A class or storage change takes effect now rather than at some Sunday
  # morning the operator did not choose. Both cause a brief outage; a change
  # that quietly did not happen yet is worse.
  apply_immediately = true

  tags = {
    Name = "${var.name_prefix}-db"
  }
}

# The whole contract with the instance, in one parameter.
#
# `sslmode=verify-full` is not optional dressing: PostgreSQL 17 on RDS sets
# `rds.force_ssl=1` in its default parameter group, so the server refuses
# plaintext, and the app's driver verifies the chain properly — which needs a
# root bundle on disk. user_data downloads it to `local.rds_ca_path` and mounts
# it into the container at the same path, which is why that path is a local and
# not a string typed twice.
resource "aws_ssm_parameter" "db_url" {
  name        = "/${var.name_prefix}/db-url"
  description = "DATABASE_URL for the ${var.name_prefix} instance"
  type        = "SecureString"

  value = format(
    "postgres://%s:%s@%s:%s/%s?sslmode=verify-full&sslrootcert=%s",
    aws_db_instance.main.username,
    random_password.db.result,
    aws_db_instance.main.address,
    aws_db_instance.main.port,
    aws_db_instance.main.db_name,
    local.rds_ca_path,
  )

  tags = {
    Name = "${var.name_prefix}-db-url"
  }
}
