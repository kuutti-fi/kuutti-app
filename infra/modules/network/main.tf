# One VPC per environment (TD-4, TD-19): a public subnet for the single API
# box and two private subnets for RDS, which needs a subnet group across two
# availability zones even for a single-AZ instance. No NAT gateway: the box is
# public and RDS makes no outbound connections, so nothing private needs egress.

data "aws_availability_zones" "available" {
  state = "available"

  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

locals {
  name = "${var.project}-${var.environment}"
  azs  = slice(sort(data.aws_availability_zones.available.names), 0, 2)

  public_cidr   = cidrsubnet(var.vpc_cidr, 8, 0)
  private_cidrs = [cidrsubnet(var.vpc_cidr, 8, 10), cidrsubnet(var.vpc_cidr, 8, 11)]
}

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = local.name }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = { Name = local.name }
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.public_cidr
  availability_zone = local.azs[0]

  # The instance gets an Elastic IP; nothing else in this subnet needs an
  # address on launch.
  map_public_ip_on_launch = false

  tags = { Name = "${local.name}-public", Tier = "public" }
}

resource "aws_subnet" "private" {
  count = 2

  vpc_id            = aws_vpc.this.id
  cidr_block        = local.private_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = { Name = "${local.name}-private-${local.azs[count.index]}", Tier = "private" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# The private subnets stay on the VPC's main route table, which only knows the
# local route. That is the whole point: no path in or out except through the
# API security group inside the VPC.

resource "aws_db_subnet_group" "this" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id

  tags = { Name = local.name }
}

# ---------------------------------------------------------------------------
# Security groups. Rules are separate resources so a change to one rule never
# rewrites the whole group.
# ---------------------------------------------------------------------------

resource "aws_security_group" "api" {
  name        = "${local.name}-api"
  description = "The API instance: HTTPS and HTTP from anywhere (Traefik terminates TLS), SSH only from the maintainer list."
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${local.name}-api" }
}

resource "aws_vpc_security_group_ingress_rule" "api_https" {
  security_group_id = aws_security_group.api.id
  description       = "HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

# Port 80 exists for the ACME HTTP-01 challenge and the redirect to HTTPS.
resource "aws_vpc_security_group_ingress_rule" "api_http" {
  security_group_id = aws_security_group.api.id
  description       = "HTTP: ACME challenge and redirect"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "api_ssh" {
  for_each = toset(var.ssh_cidrs)

  security_group_id = aws_security_group.api.id
  description       = "SSH from the maintainer, until Session Manager is proven"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
}

resource "aws_vpc_security_group_egress_rule" "api_all" {
  security_group_id = aws_security_group.api.id
  description       = "Package mirrors, container registries, AWS APIs, Telia, Expo"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "db" {
  name        = "${local.name}-db"
  description = "RDS: Postgres from the API security group only, no egress (TD-19)."
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${local.name}-db" }
}

# Hard rule of TD-19: only the API instance reaches the database. The source is
# the API security group, not a CIDR, so a replaced instance keeps access and a
# throwaway instance in the same subnet does not get it.
resource "aws_vpc_security_group_ingress_rule" "db_from_api" {
  security_group_id            = aws_security_group.db.id
  description                  = "Postgres from the API instance"
  referenced_security_group_id = aws_security_group.api.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
