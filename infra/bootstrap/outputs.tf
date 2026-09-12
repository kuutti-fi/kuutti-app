output "state_bucket" {
  description = "Backend bucket. Put this in the backend block of every environment."
  value       = aws_s3_bucket.state.id
}

output "backend_config" {
  description = "Paste into versions.tf of each environment, changing the key."
  value       = <<-EOT
    backend "s3" {
      bucket       = "${aws_s3_bucket.state.id}"
      key          = "<env>/terraform.tfstate"
      region       = "${var.region}"
      encrypt      = true
      use_lockfile = true
    }
  EOT
}

output "ci_plan_role_arn" {
  description = "Assumed by the plan job on pull requests and on main."
  value       = aws_iam_role.ci_plan.arn
}

output "ci_apply_role_arn" {
  description = "Assumed by the apply job, only from a GitHub environment."
  value       = aws_iam_role.ci_apply.arn
}

output "oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github.arn
}

output "permissions_boundary_arn" {
  description = "Every role created by the apply role must set permissions_boundary to this ARN, or the create call is refused."
  value       = aws_iam_policy.boundary.arn
}
