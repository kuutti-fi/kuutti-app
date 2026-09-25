# DNS for prod (TD-4): the zone belongs to the bootstrap (adopted from the
# Route 53 registration), the records to the environment that owns the
# address: the API and Dokploy's own UI and API (called by CI). All point at the Elastic IP; Traefik on the box terminates
# TLS with one Let's Encrypt certificate per host; CloudFront fronts the API once media_enabled is set (ADR-005).

data "aws_route53_zone" "main" {
  name = var.domain
}

# With media_enabled, api is the distribution's alias (modules/media) and the
# box answers to origin.api for CloudFront (ADR-005).
resource "aws_route53_record" "box" {
  for_each = toset(concat(["dokploy"], var.media_enabled ? ["origin.api"] : ["api"]))

  zone_id = data.aws_route53_zone.main.zone_id
  name    = "${each.key}.${var.domain}"
  type    = "A"
  ttl     = 300
  records = [module.compute.public_ip]
}
