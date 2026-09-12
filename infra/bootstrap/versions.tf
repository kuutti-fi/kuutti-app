terraform {
  required_version = ">= 1.10" # use_lockfile needs 1.10

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Left commented on the first run: this configuration creates the bucket that
  # holds the state. After the first apply, uncomment, run
  # `tofu init -migrate-state`, and delete the local state files.
  #
  # backend "s3" {
  #   bucket       = "kuutti-tfstate-<account-id>"
  #   key          = "bootstrap/terraform.tfstate"
  #   region       = "eu-central-1"
  #   encrypt      = true
  #   use_lockfile = true   # native S3 locking; DynamoDB locking is deprecated
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "opentofu"
      Component = "bootstrap"
    }
  }
}
