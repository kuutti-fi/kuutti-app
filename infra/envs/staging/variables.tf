variable "vpc_cidr" {
  type    = string
  default = "10.10.0.0/16"
}

variable "instance_type" {
  type    = string
  default = "t4g.small"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_deletion_protection" {
  type    = bool
  default = false
}

variable "ssh_cidrs" {
  description = "Maintainer CIDRs for port 22, empty by default; Session Manager is the intended path."
  type        = list(string)
  default     = []
}

variable "dokploy_version" {
  description = "Dokploy release tag installed at first boot (the dokploy/dokploy image tag). Bumped deliberately; a running box is updated with the installer's update command, not by apply."
  type        = string
  default     = "v0.30.6"
}

variable "domain" {
  description = "The project domain; its hosted zone is declared in infra/bootstrap."
  type        = string
  default     = "kuutti.app"
}
