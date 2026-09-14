output "identifier" {
  value = aws_db_instance.this.identifier
}

output "arn" {
  value = aws_db_instance.this.arn
}

output "address" {
  description = "Hostname the API puts into DATABASE_URL via /kuutti/<env>/db-host."
  value       = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "db_name" {
  value = aws_db_instance.this.db_name
}

output "master_username" {
  value = aws_db_instance.this.username
}

output "master_user_secret_arn" {
  description = "Secrets Manager secret holding the master password; read by the maintainer once to create the application role."
  value       = one(aws_db_instance.this.master_user_secret).secret_arn
}

output "resource_id" {
  value = aws_db_instance.this.resource_id
}
