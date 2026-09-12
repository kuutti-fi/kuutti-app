variable "project" {
  description = "Name prefix for all resources."
  type        = string
  default     = "kuutti"
}

variable "region" {
  description = "AWS region. Everything lives in one region (TD-4)."
  type        = string
  default     = "eu-central-1"
}

# kuutti-app was created after 15 July 2026, so GitHub issues immutable subject
# claims: the sub is repo:kuutti-fi@<owner_id>/kuutti-app@<repo_id>:... rather
# than the name-based form. Trust policies below key on these numeric IDs, which
# are stable across renames. Get them with:
#   gh api repos/kuutti-fi/kuutti-app --jq '{repo_id: .id, owner_id: .owner.id}'

variable "github_owner_id" {
  description = "Numeric ID of the kuutti-fi organisation."
  type        = string
}

variable "github_repository_id" {
  description = "Numeric ID of the kuutti-app repository."
  type        = string
}

variable "deploy_environments" {
  description = "GitHub environments allowed to assume the apply role."
  type        = list(string)
  default     = ["staging", "prod"]
}
