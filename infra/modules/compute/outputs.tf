output "instance_id" {
  value = aws_instance.api.id
}

output "public_ip" {
  description = "The Elastic IP; DNS for api.<domain> points here."
  value       = aws_eip.api.public_ip
}

output "role_name" {
  value = aws_iam_role.api.name
}

output "role_arn" {
  value = aws_iam_role.api.arn
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.api.name
}

output "ssm_prefix" {
  value = local.ssm_prefix
}

output "backup_prefix" {
  value = "s3://${var.backup_bucket}/${local.backup_prefix}"
}
