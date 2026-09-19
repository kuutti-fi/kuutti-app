# RDS for PostgreSQL, single AZ, one instance per environment (TD-19). The
# master password is generated and held by AWS (manage_master_user_password),
# which is the one sanctioned use of Secrets Manager (ADR-001); the application
# connects as its own role whose password lives in SSM as
# /kuutti/<env>/db-app-password, created by infra/scripts/db-app-role.sh.

locals {
  identifier = "${var.project}-${var.environment}"
  db_name    = var.project
}

# TLS is mandatory on the wire; the API connects with sslmode=verify-full and
# the regional RDS root bundle it ships (apps/api/certs).
resource "aws_db_parameter_group" "this" {
  name_prefix = "${local.identifier}-postgres17-"
  family      = "postgres17"
  description = "${local.identifier}: force TLS"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "this" {
  identifier = local.identifier

  engine         = "postgres"
  engine_version = "17" # major only: minors follow auto_minor_version_upgrade; bump here before 17 leaves standard support, or the forced upgrade reads as a downgrade
  instance_class = var.instance_class

  # Extended Support declined (TD-19): when 17 reaches end of standard support
  # the instance is upgraded to the next major rather than billed for support.
  engine_lifecycle_support   = "open-source-rds-extended-support-disabled"
  auto_minor_version_upgrade = true
  apply_immediately          = false
  maintenance_window         = "sun:01:00-sun:02:00" # 03:00 or 04:00 in Finland
  backup_window              = "23:30-00:00"
  backup_retention_period    = 35 # point-in-time recovery window (TD-19)
  copy_tags_to_snapshot      = true

  db_name  = local.db_name
  username = "${var.project}_admin"
  port     = 5432

  manage_master_user_password = true

  allocated_storage     = var.allocated_storage_gb
  max_allocated_storage = var.max_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = var.db_subnet_group_name
  vpc_security_group_ids = [var.db_security_group_id]
  parameter_group_name   = aws_db_parameter_group.this.name
  publicly_accessible    = false
  multi_az               = false

  # Free tier of Performance Insights; enhanced monitoring stays off (costs).
  performance_insights_enabled          = true
  performance_insights_retention_period = 7
  monitoring_interval                   = 0

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = !var.deletion_protection
  final_snapshot_identifier = var.deletion_protection ? "${local.identifier}-final" : null

  tags = { Name = local.identifier }
}
