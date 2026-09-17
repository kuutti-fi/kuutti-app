# DNS for staging (TD-4): the zone belongs to the bootstrap (adopted from the
# Route 53 registration), the records to the environment that owns the
# address: the API, Dokploy's own UI and API (called by CI), and the pull-request previews (#9). All point at the Elastic IP; Traefik on the box terminates
# TLS with one Let's Encrypt certificate per host until CloudFront (M3).

data "aws_route53_zone" "main" {
  name = var.domain
}

resource "aws_route53_record" "box" {
  for_each = toset(["api.staging", "dokploy.staging", "*.preview.api.staging"])

  zone_id = data.aws_route53_zone.main.zone_id
  name    = "${each.key}.${var.domain}"
  type    = "A"
  ttl     = 300
  records = [module.compute.public_ip]
}
