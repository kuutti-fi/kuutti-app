terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      # The outside probe (probe.tf): Route 53 health-check metrics exist only
      # in us-east-1, so its alarm and topic need a provider there. The caller
      # passes `aws.us_east_1` alongside the regional one.
      configuration_aliases = [aws.us_east_1]
    }
  }
}
