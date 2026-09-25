output "bucket" {
  description = "SSM parameter s3-bucket: the API's S3_BUCKET."
  value       = aws_s3_bucket.media.bucket
}

output "media_url_base" {
  description = "SSM parameter media-url-base: the API's MEDIA_URL_BASE, the distribution's name; objects are signed under /media/."
  value       = "https://${var.api_fqdn}"
}

output "key_pair_id" {
  description = "SSM parameter cloudfront-key-pair-id: the API's CLOUDFRONT_KEY_PAIR_ID, the id of the public key resource (Key-Pair-Id in every signed URL)."
  value       = aws_cloudfront_public_key.signing.id
}

output "distribution_id" {
  value = aws_cloudfront_distribution.this.id
}

output "distribution_domain_name" {
  value = aws_cloudfront_distribution.this.domain_name
}

output "certificate_arn" {
  value = aws_acm_certificate_validation.api.certificate_arn
}
