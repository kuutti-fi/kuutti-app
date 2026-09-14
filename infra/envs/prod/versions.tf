terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # One key per environment in the bootstrap's bucket (ADR-001).
  backend "s3" {
    bucket       = "kuutti-tfstate-438298963814"
    key          = "prod/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = "eu-central-1"

  default_tags {
    tags = {
      Project     = "kuutti"
      ManagedBy   = "opentofu"
      Environment = "prod"
    }
  }
}
