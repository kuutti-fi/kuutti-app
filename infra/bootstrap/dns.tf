# ---------------------------------------------------------------------------
# The project domain (TD-4). kuutti.app was registered through Route 53 in
# this account on 2026-09-17: a purchase with contact details, which cannot be
# code, so like the account itself it is the click-ops ADR-001 allows. Route 53
# created the hosted zone at registration. It is adopted here rather than
# recreated: a new zone would get other name servers than the registration
# points at. The import block stays, so a rebuilt state adopts it again.
# Records live with the environment that owns their target (envs/*/dns.tf)
# and look the zone up by name.
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
