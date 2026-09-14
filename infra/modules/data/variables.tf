variable "project" {
  type    = string
  default = "kuutti"
}

variable "environment" {
  type = string

  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be staging or prod."
  }
}

variable "instance_class" {
  description = "db.t4g.micro on staging, db.t4g.small on prod (#7)."
  type        = string
}

variable "db_subnet_group_name" {
  type = string
}

variable "db_security_group_id" {
  type = string
}

variable "deletion_protection" {
  description = "On for prod. Also decides whether a final snapshot is taken on destroy."
  type        = bool
}

variable "allocated_storage_gb" {
  type    = number
  default = 20
}

variable "max_allocated_storage_gb" {
  description = "Storage autoscaling ceiling (TD-19)."
  type        = number
  default     = 100
}
