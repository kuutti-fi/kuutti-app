output "vpc_id" {
  value = aws_vpc.this.id
}

output "public_subnet_id" {
  description = "Where the API instance lives."
  value       = aws_subnet.public.id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "db_subnet_group_name" {
  value = aws_db_subnet_group.this.name
}

output "api_security_group_id" {
  value = aws_security_group.api.id
}

output "db_security_group_id" {
  value = aws_security_group.db.id
}
