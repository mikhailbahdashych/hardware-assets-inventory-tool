# Where attachments go. Naming `S3_BUCKET` is the whole switch on the app side:
# uploads land here instead of on the volume, and downloads still stream back
# through the app under a session — no presigned URL ever reaches a browser,
# which is why this bucket is private and stays that way.

resource "aws_s3_bucket" "attachments" {
  # A prefix rather than a name: S3 names are global, so a fixed default would
  # work exactly once, for whoever applied this first.
  bucket_prefix = "${var.name_prefix}-attachments-"

  # Versioning is on below, so `destroy` cannot remove this bucket while any
  # object or delete marker is left in it. This is the flag that lets it — set
  # `bucket_force_destroy = true` before tearing the stack down, and understand
  # that it deletes every attachment version without asking.
  force_destroy = var.bucket_force_destroy

  tags = {
    Name = "${var.name_prefix}-attachments"
  }
}

resource "aws_s3_bucket_public_access_block" "attachments" {
  bucket = aws_s3_bucket.attachments.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "attachments" {
  bucket = aws_s3_bucket.attachments.id

  # SSE-S3 rather than a customer-managed KMS key: the instance role would then
  # need grants on the key as well, and nothing here is worth that second thing
  # to get wrong. Swap `sse_algorithm` to `aws:kms` and add the key grants to
  # iam.tf if your compliance line asks for it.
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "attachments" {
  bucket = aws_s3_bucket.attachments.id

  # The app's nightly sweep deletes orphaned objects, and a person deleting an
  # asset deletes its attachments. Versioning is what makes both of those
  # recoverable for as long as you keep the old versions.
  versioning_configuration {
    status = "Enabled"
  }
}
