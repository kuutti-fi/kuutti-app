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

variable "domain" {
  description = "The project domain; the certificate and the alias records live in its zone."
  type        = string
}

variable "zone_id" {
  description = "Hosted zone of the project domain (data.aws_route53_zone in the environment)."
  type        = string
}

variable "api_fqdn" {
  description = "The public name of the API, which becomes the distribution's alias: api.<env>.<domain>. Photos are served under /media/ on the same name."
  type        = string
}

variable "origin_fqdn" {
  description = "The name the distribution connects to the box by, pointing at the Elastic IP (origin.api.<env>.<domain>): Traefik must hold a certificate for it."
  type        = string
}

variable "instance_role_name" {
  description = "The API box's instance role (modules/compute output role_name); it gets the bucket policy attached."
  type        = string
}

variable "signing_public_key_pem" {
  description = "The public half of the CloudFront signing key pair, PEM. The private half is /kuutti/<env>/cloudfront-signing-key in SSM and never in code (ADR-001, ADR-005). Checked by a precondition on the public key resource, so a dormant module (count = 0) with an empty value still validates."
  type        = string
}
