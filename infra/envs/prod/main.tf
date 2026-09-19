# The prod environment: network, database and the API box (#7, TD-19).
# Applied by CI through kuutti-ci-apply from the GitHub environment "prod" (#8).

data "aws_caller_identity" "current" {}

locals {
  environment = "prod"
  account_id  = data.aws_caller_identity.current.account_id

  # Bootstrap outputs, reconstructed by name rather than read from its state.
  permissions_boundary_arn = "arn:aws:iam::${local.account_id}:policy/kuutti/kuutti-boundary"
  state_bucket             = "kuutti-tfstate-${local.account_id}"
}

module "network" {
  source = "../../modules/network"

  environment = local.environment
  vpc_cidr    = var.vpc_cidr
  ssh_cidrs   = var.ssh_cidrs
}

module "data" {
  source = "../../modules/data"

  environment          = local.environment
  instance_class       = var.db_instance_class
  db_subnet_group_name = module.network.db_subnet_group_name
  db_security_group_id = module.network.db_security_group_id
  deletion_protection  = var.db_deletion_protection
}

module "compute" {
  source = "../../modules/compute"

  environment                = local.environment
  instance_type              = var.instance_type
  subnet_id                  = module.network.public_subnet_id
  security_group_id          = module.network.api_security_group_id
  permissions_boundary_arn   = local.permissions_boundary_arn
  backup_bucket              = local.state_bucket
  dokploy_version            = var.dokploy_version
  domain                     = var.domain
  manage_session_preferences = false
}

# Alarms, the alert topic and the saved log queries (#11).
module "observability" {
  source = "../../modules/observability"

  environment    = local.environment
  instance_id    = module.compute.instance_id
  db_identifier  = module.data.identifier
  log_group_name = module.compute.log_group_name
  alert_email    = var.alert_email
}

# Non-secret configuration the API reads at boot from /kuutti/prod/ (TD-19).
# Each key becomes the upper-cased environment variable (db-host -> DB_HOST).
# Secrets are never resources (ADR-001): db-app-password comes from
# infra/scripts/db-app-role.sh, the signing keys from their milestones.
resource "aws_ssm_parameter" "config" {
  for_each = {
    "app-env"   = "production"
    "log-level" = "info"
    "db-host"   = module.data.address
    "db-port"   = tostring(module.data.port)
    "db-name"   = module.data.db_name
    "db-user"   = "kuutti_app"
  }

  name  = "${module.compute.ssm_prefix}${each.key}"
  type  = "String"
  value = each.value
}
