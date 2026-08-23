# Nothing here is a secret, deliberately. The one credential this stack
# generates lives in the SSM parameter below and is never an output — reading
# it means asking SSM, which is an API call somebody's IAM policy can refuse
# and CloudTrail records.

output "app_url" {
  description = "Where a browser reaches the app. This is exactly the value the instance runs with as APP_URL; if the two ever disagree, every save is a 403."
  value       = local.app_url
}

output "instance_id" {
  description = "For `aws ssm start-session --target <id>` — the only way in, since this stack creates no SSH key and opens no port 22."
  value       = aws_instance.app.id
}

output "rds_endpoint" {
  description = "host:port of the database. Private to the VPC; reaching it from a laptop means a tunnel through the instance."
  value       = aws_db_instance.main.endpoint
}

output "bucket" {
  description = "The attachments bucket. Empty it before `terraform destroy` unless bucket_force_destroy is true."
  value       = aws_s3_bucket.attachments.bucket
}

output "ssm_parameter_name" {
  description = "The SecureString holding DATABASE_URL. `aws ssm get-parameter --name <it> --with-decryption` is how a person reads it."
  value       = aws_ssm_parameter.db_url.name
}
