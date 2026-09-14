output "instance_id" {
  value = module.compute.instance_id
}

output "public_ip" {
  description = "Point api.<domain> here."
  value       = module.compute.public_ip
}

output "db_identifier" {
  value = module.data.identifier
}

output "db_host" {
  value = module.data.address
}

output "db_master_secret_arn" {
  description = "Read once by the maintainer to create the application role (infra/scripts/db-app-role.sh)."
  value       = module.data.master_user_secret_arn
}

output "log_group_name" {
  value = module.compute.log_group_name
}

output "backup_prefix" {
  value = module.compute.backup_prefix
}
