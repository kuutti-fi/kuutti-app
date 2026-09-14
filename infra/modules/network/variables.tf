variable "project" {
  description = "Name prefix for every resource."
  type        = string
  default     = "kuutti"
}

variable "environment" {
  description = "staging or prod. Names resources and the Environment tag."
  type        = string

  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be staging or prod."
  }
}

variable "vpc_cidr" {
  description = "One /16 per environment; the four subnets are carved from it."
  type        = string
}

variable "ssh_cidrs" {
  description = "CIDRs allowed to reach port 22 on the API instance. Empty means no SSH rule at all; Session Manager is the intended path and this list exists only until it is proven (#7)."
  type        = list(string)
  default     = []
}
