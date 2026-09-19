# ---------------------------------------------------------------------------
# The project domain (TD-4). kuutti.app was registered through Route 53 in
# this account on 2026-09-17: a purchase with contact details, which cannot be
# code, so like the account itself it is the click-ops ADR-001 allows. Route 53
# created the hosted zone at registration. It is adopted here rather than
# recreated: a new zone would get other name servers than the registration
# points at. The import block stays, so a rebuilt state adopts it again.
# Records live with the environment that owns their target (envs/*/dns.tf)
# and look the zone up by name. Domain-wide records that belong to no
# environment (CAA, the mail-refusing SPF, DMARC and null MX below) live here.
# ---------------------------------------------------------------------------

import {
  to = aws_route53_zone.main
  id = "Z004088624ZDOS9GD322O"
}

resource "aws_route53_zone" "main" {
  name    = var.domain
  comment = "HostedZone created by Route53 Registrar"

  lifecycle {
    prevent_destroy = true
  }
}

# ---------------------------------------------------------------------------
# Domain-wide policy records. Nothing sends mail as @kuutti.app yet, and
# nothing should be able to: a "-all" SPF, a reject DMARC and a null MX say so
# to every receiver, which is what stops the domain being spoofed while it
# has no mailbox. CAA limits who may issue certificates for the domain to the
# two issuers in use: ACM (Amplify Hosting, later CloudFront) and Let's
# Encrypt (Traefik on the boxes). No issuewild: wildcards are not used. When
# the project has a mailbox, add an iodef record and replace the SPF.
# ---------------------------------------------------------------------------

resource "aws_route53_record" "caa" {
  zone_id = aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "CAA"
  ttl     = 3600
  records = [
    "0 issue \"amazon.com\"",
    "0 issue \"amazontrust.com\"",
    "0 issue \"awstrust.com\"",
    "0 issue \"amazonaws.com\"",
    "0 issue \"letsencrypt.org\"",
  ]
}

resource "aws_route53_record" "spf" {
  zone_id = aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "TXT"
  ttl     = 3600
  records = ["v=spf1 -all"]
}

resource "aws_route53_record" "dmarc" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  ttl     = 3600
  records = ["v=DMARC1; p=reject; adkim=s; aspf=s"]
}

# RFC 7505: a null MX tells senders the domain accepts no mail at all.
resource "aws_route53_record" "null_mx" {
  zone_id = aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "MX"
  ttl     = 3600
  records = ["0 ."]
}
