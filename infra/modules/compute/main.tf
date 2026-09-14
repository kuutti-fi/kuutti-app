# The one API box per environment (TD-4, project context §2): t4g.small, Ubuntu
# 24.04 arm64, an Elastic IP, and an instance role that reaches exactly its own
# SSM prefix, its own log group and its backup prefix (TD-19, TD-4 access rule).
# The bucket, Rekognition and SES arrive with M3 and M5, never earlier.

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Canonical publishes the current AMI id as a public parameter; resolving it at
# plan time and ignoring later changes (lifecycle below) means a new image never
# silently replaces the box. Rebuild deliberately with `tofu apply -replace`.
data "aws_ssm_parameter" "ubuntu_arm64" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id"
}

locals {
  name              = "${var.project}-${var.environment}"
  region            = data.aws_region.current.region
  account_id        = data.aws_caller_identity.current.account_id
  iam_path          = "/${var.project}/"
  ssm_prefix        = "/${var.project}/${var.environment}/"
  log_group_name    = "/${var.project}/${var.environment}/api"
  session_log_group = "/${var.project}/ssm-sessions"
  backup_prefix     = "dokploy-backup/${var.environment}/"
}

# ---------------------------------------------------------------------------
# Logs. Every container on the box logs here through the awslogs driver, one
# stream per container name; 30 days is the retention rules/infra.md sets.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "api" {
  name              = local.log_group_name
  retention_in_days = 30
}

# ---------------------------------------------------------------------------
# Instance role. Bounded by the bootstrap policy (ADR-001), scoped to this
# environment: the staging role cannot read /kuutti/prod/* and vice versa.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "assume_ec2" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "api" {
  # Configuration and secrets at boot (TD-19). Both ARN shapes are needed:
  # GetParametersByPath is evaluated against the path, GetParameter against
  # the parameter.
  statement {
    sid     = "OwnParameters"
    effect  = "Allow"
    actions = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
    resources = [
      "arn:aws:ssm:${local.region}:${local.account_id}:parameter${trimsuffix(local.ssm_prefix, "/")}",
      "arn:aws:ssm:${local.region}:${local.account_id}:parameter${local.ssm_prefix}*",
    ]
  }

  # AmazonSSMManagedInstanceCore (attached below for Session Manager) allows
  # ssm:GetParameter and ssm:GetParameters on every parameter in the account,
  # which would let this box read the other environment's secrets. An explicit
  # deny outside the own prefix wins over that allow; nothing the agent does
  # here reads parameters, so it loses nothing.
  statement {
    sid    = "NoOtherParameters"
    effect = "Deny"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
      "ssm:GetParameterHistory",
    ]
    not_resources = [
      "arn:aws:ssm:${local.region}:${local.account_id}:parameter${trimsuffix(local.ssm_prefix, "/")}",
      "arn:aws:ssm:${local.region}:${local.account_id}:parameter${local.ssm_prefix}*",
    ]
  }

  # SecureStrings under the default aws/ssm key, and SSE-KMS objects in S3.
  # ViaService keeps this to those two uses; the AWS-managed keys are created
  # lazily by AWS, so they are not looked up here.
  statement {
    sid       = "KmsThroughSsmAndS3"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey*"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${local.region}.amazonaws.com", "s3.${local.region}.amazonaws.com"]
    }
  }

  statement {
    sid    = "OwnLogGroup"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
    ]
    resources = [
      "${aws_cloudwatch_log_group.api.arn}:*",
      "arn:aws:logs:${local.region}:${local.account_id}:log-group:${local.session_log_group}:*",
    ]
  }

  # The agent checks the session log group exists before it streams to it.
  statement {
    sid       = "DescribeLogGroups"
    effect    = "Allow"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }

  # Nightly Dokploy backup. SSE-KMS is required so the objects stay unreadable
  # to the plan role, which may read the state bucket but is explicitly denied
  # kms:Decrypt (bootstrap). The box may read its own backups back for a
  # rebuild (README); it can never delete them or touch state.
  statement {
    sid       = "DokployBackupWrite"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["arn:aws:s3:::${var.backup_bucket}/${local.backup_prefix}*"]

    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
    }
  }

  statement {
    sid       = "DokployBackupRead"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${var.backup_bucket}/${local.backup_prefix}*"]
  }

  statement {
    sid       = "DokployBackupList"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.backup_bucket}"]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${local.backup_prefix}*"]
    }
  }
}

resource "aws_iam_role" "api" {
  name                 = "${var.project}-api-${var.environment}"
  path                 = local.iam_path
  assume_role_policy   = data.aws_iam_policy_document.assume_ec2.json
  permissions_boundary = var.permissions_boundary_arn
  description          = "Instance role of the ${var.environment} API box: its own SSM prefix, log group and backup prefix."
}

resource "aws_iam_role_policy" "api" {
  name   = "own-resources"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

# Session Manager instead of SSH keys.
resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "api" {
  name = aws_iam_role.api.name
  path = local.iam_path
  role = aws_iam_role.api.name
}

# ---------------------------------------------------------------------------
# Session Manager logging, account-wide, declared once (see the variable).
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "ssm_sessions" {
  count = var.manage_session_preferences ? 1 : 0

  name              = local.session_log_group
  retention_in_days = 90
}

resource "aws_ssm_document" "session_preferences" {
  count = var.manage_session_preferences ? 1 : 0

  name            = "SSM-SessionManagerRunShell"
  document_type   = "Session"
  document_format = "JSON"

  content = jsonencode({
    schemaVersion = "1.0"
    description   = "Session Manager preferences: every shell is streamed to CloudWatch Logs (#7)."
    sessionType   = "Standard_Stream"
    inputs = {
      cloudWatchLogGroupName      = aws_cloudwatch_log_group.ssm_sessions[0].name
      cloudWatchEncryptionEnabled = false
      cloudWatchStreamingEnabled  = true
      idleSessionTimeout          = "20"
      maxSessionDuration          = "120"
      runAsEnabled                = false
      # Sessions run as ssm-user; `sudo -i` for root. Every keystroke and
      # every line of output is streamed, so never echo a secret in one.
      shellProfile = {
        linux = "bash"
      }
    }
  })
}

# ---------------------------------------------------------------------------
# The box.
# ---------------------------------------------------------------------------

resource "aws_instance" "api" {
  ami                    = data.aws_ssm_parameter.ubuntu_arm64.value
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [var.security_group_id]
  iam_instance_profile   = aws_iam_instance_profile.api.name

  # IMDSv2 only. Hop limit 2 so containers on the Docker bridge can reach the
  # instance role, which is how the API gets its credentials (TD-19).
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_gb
    encrypted             = true
    delete_on_termination = true
  }

  # The Dokploy installer is vendored (installer/) and the box verifies what it
  # downloads against that copy's hash, so what runs as root at first boot is
  # exactly what was reviewed here.
  user_data = templatefile("${path.module}/templates/user_data.sh.tpl", {
    hostname                 = local.name
    region                   = local.region
    log_group                = local.log_group_name
    backup_bucket            = var.backup_bucket
    backup_prefix            = local.backup_prefix
    dokploy_version          = var.dokploy_version
    dokploy_installer_sha256 = filesha256("${path.module}/installer/dokploy-install.sh")
  })

  # A newer AMI or an edited first-boot script must not replace the running
  # box: Dokploy's configuration is the one manual island (ADR-001). Rebuild on
  # purpose with `tofu apply -replace=module.compute.aws_instance.api`.
  lifecycle {
    ignore_changes = [ami, user_data]
  }

  tags = { Name = local.name }
}

resource "aws_eip" "api" {
  domain = "vpc"

  tags = { Name = local.name }
}

resource "aws_eip_association" "api" {
  instance_id   = aws_instance.api.id
  allocation_id = aws_eip.api.id
}
