# The optional half of this stack: a name, a certificate and a load balancer to
# terminate TLS on. Set `domain` and `route53_zone_id` and everything in this
# file appears; leave them null and none of it does, which is the default.
#
# Honest label: this file has never been applied. The path that gets stood up
# and torn down for real is the default one — no domain, the app answering on
# its Elastic IP. This was written and reviewed against the provider's
# documentation, not run. Read it before you trust it, and expect the first
# `apply` with a domain to want a fix or two.

resource "aws_acm_certificate" "app" {
  count = local.domain_enabled ? 1 : 0

  domain_name       = var.domain
  validation_method = "DNS"

  # A certificate is referenced by the listener, so replacing one in place
  # would take the listener down with it.
  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = var.name_prefix
  }
}

# One domain, so one validation record — `count` rather than `for_each` over
# `domain_validation_options`, whose keys are not known until the certificate
# exists and would make the plan itself fail.
resource "aws_route53_record" "cert_validation" {
  count = local.domain_enabled ? 1 : 0

  zone_id = var.route53_zone_id
  name    = tolist(aws_acm_certificate.app[0].domain_validation_options)[0].resource_record_name
  type    = tolist(aws_acm_certificate.app[0].domain_validation_options)[0].resource_record_type
  records = [tolist(aws_acm_certificate.app[0].domain_validation_options)[0].resource_record_value]
  ttl     = 60

  # Re-applying after a certificate is replaced writes the same name again.
  allow_overwrite = true
}

# Not a resource so much as a wait: it blocks until ACM has seen the record.
resource "aws_acm_certificate_validation" "app" {
  count = local.domain_enabled ? 1 : 0

  certificate_arn         = aws_acm_certificate.app[0].arn
  validation_record_fqdns = aws_route53_record.cert_validation[*].fqdn
}

resource "aws_security_group" "alb" {
  count = local.domain_enabled ? 1 : 0

  name        = "${var.name_prefix}-alb"
  description = "HTTP and HTTPS from anywhere, to the load balancer"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name = "${var.name_prefix}-alb"
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  count = local.domain_enabled ? 1 : 0

  security_group_id = aws_security_group.alb[0].id
  description       = "HTTPS from anywhere"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  count = local.domain_enabled ? 1 : 0

  security_group_id = aws_security_group.alb[0].id
  description       = "HTTP from anywhere, redirected to HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  count = local.domain_enabled ? 1 : 0

  security_group_id            = aws_security_group.alb[0].id
  description                  = "To the application instance"
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 80
  to_port                      = 80
}

# With a load balancer in front, the instance stops being reachable from the
# world: ec2.tf's two open rules are not created, and this is the only way in.
resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  count = local.domain_enabled ? 1 : 0

  security_group_id            = aws_security_group.app.id
  description                  = "HTTP from the load balancer only"
  referenced_security_group_id = aws_security_group.alb[0].id
  ip_protocol                  = "tcp"
  from_port                    = 80
  to_port                      = 80
}

resource "aws_lb" "app" {
  count = local.domain_enabled ? 1 : 0

  name               = "${var.name_prefix}-alb"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb[0].id]
  # Both public subnets, which is the reason there are two of them.
  subnets = aws_subnet.public[*].id

  tags = {
    Name = "${var.name_prefix}-alb"
  }
}

resource "aws_lb_target_group" "app" {
  count = local.domain_enabled ? 1 : 0

  name        = "${var.name_prefix}-app"
  vpc_id      = aws_vpc.main.id
  target_type = "instance"
  port        = 80
  protocol    = "HTTP"

  # The same endpoint the image's own healthcheck uses. It runs a query against
  # the database before it answers, so it speaks for the process and its rows.
  health_check {
    path                = "/api/v1/healthz"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Name = "${var.name_prefix}-app"
  }
}

resource "aws_lb_target_group_attachment" "app" {
  count = local.domain_enabled ? 1 : 0

  target_group_arn = aws_lb_target_group.app[0].arn
  target_id        = aws_instance.app.id
  port             = 80
}

resource "aws_lb_listener" "https" {
  count = local.domain_enabled ? 1 : 0

  load_balancer_arn = aws_lb.app[0].arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  # The validation resource rather than the certificate, so the listener is not
  # created with a certificate ACM has not issued yet.
  certificate_arn = aws_acm_certificate_validation.app[0].certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app[0].arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  count = local.domain_enabled ? 1 : 0

  load_balancer_arn = aws_lb.app[0].arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_route53_record" "app" {
  count = local.domain_enabled ? 1 : 0

  zone_id = var.route53_zone_id
  name    = var.domain
  type    = "A"

  alias {
    name                   = aws_lb.app[0].dns_name
    zone_id                = aws_lb.app[0].zone_id
    evaluate_target_health = true
  }
}
