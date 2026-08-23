# One VPC, two availability zones, and deliberately no NAT gateway.
#
# The instance lives in a public subnet with an Elastic IP, so its outbound
# traffic — pulling the image, reaching SSM, writing to S3 — goes straight out
# of the internet gateway. A NAT gateway would add roughly the cost of the
# instance itself for nothing this stack needs. The database is private and
# talks to nobody but the instance.

data "aws_availability_zones" "available" {
  state = "available"

  # Local Zones and Wavelength Zones answer this query too, and an RDS subnet
  # group in one is an apply that fails halfway.
  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = var.name_prefix
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = var.name_prefix
  }
}

# Two public subnets for one instance, because an ALB needs a subnet in each of
# two zones before it will exist at all. Without the domain module the second
# one sits empty and costs nothing.
resource "aws_subnet" "public" {
  count = 2

  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.name_prefix}-public-${count.index + 1}"
  }
}

# Two private subnets, because an RDS subnet group needs two zones as well —
# even for a single-AZ instance, which is what this stack creates.
resource "aws_subnet" "private" {
  count = 2

  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name = "${var.name_prefix}-private-${count.index + 1}"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "${var.name_prefix}-public"
  }
}

resource "aws_route_table_association" "public" {
  count = length(aws_subnet.public)

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# The private subnets get a route table of their own rather than the VPC's main
# one, so the S3 endpoint below has something to attach to on that side.
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.name_prefix}-private"
  }
}

resource "aws_route_table_association" "private" {
  count = length(aws_subnet.private)

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# Attachment traffic is the only bulk this app moves, and a gateway endpoint
# keeps it on AWS's own network: no per-GB charge, and no dependency on the
# instance's public path for the one thing that will grow.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id, aws_route_table.private.id]

  tags = {
    Name = "${var.name_prefix}-s3"
  }
}
