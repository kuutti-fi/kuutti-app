variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "instance_type" {
  type    = string
  default = "t4g.small"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "db_deletion_protection" {
  type    = bool
  default = true
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

variable "alert_email" {
  description = "Subscriber of the alert topic (#11): CI passes the repository variable ALERT_EMAIL as TF_VAR_alert_email. Null leaves the topic without a subscriber."
  type        = string
  default     = null
}

variable "media_enabled" {
  description = "Photos (#48, ADR-005): the media bucket, the CloudFront distribution in front of the API and the bucket, and the signed-URL key group. Flipped to true in the cutover commit, after the maintainer has created /kuutti/<env>/cloudfront-signing-key in SSM, committed its public half as cloudfront-signing-key.pub.pem next to this file, and given the api application the origin.api.<env> domain in Dokploy (infra/README.md, Media)."
  type        = bool
  default     = false
}

variable "cloudfront_only_ingress" {
  description = "Passed to the network module: HTTPS from CloudFront's prefix list only. Off until Dokploy and the previews are behind the distribution too (ADR-005)."
  type        = bool
  default     = false
}
