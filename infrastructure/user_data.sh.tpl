#!/bin/bash
# Rendered by ec2.tf and run once, as root, by cloud-init on first boot.
# Everything it does is traced into /var/log/cloud-init-output.log, which is the
# first place to look when the instance is up and the app is not — except for
# the few lines around the database password, which are deliberately not.
#
# Terraform interpolation and shell expansion share the same dollar-brace
# syntax, so every shell variable below is written with a doubled dollar. A
# single one is a name Terraform tries to resolve at render time and cannot.
set -euxo pipefail

# --- Wait for the address APP_URL names --------------------------------------
# The Elastic IP is allocated before this instance (user_data has to be able to
# name it) and associated a moment after it starts, which is somewhere in the
# middle of this script. Until then the instance is on a different auto-assigned
# address, and every connection open across the swap dies — a `dnf install`
# among them. So the first thing to do here is nothing, until the swap lands.
#
# The token has to outlive the loop that uses it. At 300 seconds it expires on
# the last iteration of a 60 × 5 s wait, and the `|| true` below would swallow
# the 401 — turning "the address never arrived" into "the token died", which
# reads identically in the log and is not the same problem.
#
# And the token is fetched under `set -e`, so a single refused connection to an
# IMDS endpoint that is not quite up yet ends the boot right here — no
# container, and a last log line about curl. Hence the retries.
imds_token="$(curl -fsS --retry 3 --retry-connrefused -X PUT \
  http://169.254.169.254/latest/api/token \
  -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600')"
for _ in $(seq 1 60); do
  current_ip="$(curl -fsS -H "X-aws-ec2-metadata-token: $${imds_token}" \
    http://169.254.169.254/latest/meta-data/public-ipv4 || true)"
  if [ "$${current_ip}" = '${public_ip}' ]; then break; fi
  sleep 5
done

# --- Docker ------------------------------------------------------------------
dnf install -y docker
systemctl enable --now docker

# --- The RDS certificate chain -----------------------------------------------
# PostgreSQL 17 on RDS refuses plaintext connections (rds.force_ssl=1 in the
# default parameter group) and the connection string below asks the driver to
# verify the server properly, which needs a root bundle on disk. The same file
# is mounted read-only into the container at the same path, because the driver
# doing the verifying runs in there.
install -d -m 0755 "$(dirname '${rds_ca_path}')"
curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  -o '${rds_ca_path}'
chmod 0644 '${rds_ca_path}'

# --- The environment ---------------------------------------------------------
# The trace goes off for exactly as long as it takes to read the connection
# string and write it down. Everything else about this boot is worth having in
# the log; a database password in a world-readable log file is not.
#
# TRUST_PROXY is a hop count and not `true`, which would be a hole rather than a
# setting. Fastify resolves `request.ip` to the last address it still trusts in
# `X-Forwarded-For`, and `true` trusts the whole header — so it lands on the
# LEFT-most entry, the one the client wrote for itself. The load balancer
# appends the address it saw instead of replacing the header, so that entry
# survives: a caller sending a fresh `X-Forwarded-For` per request would get a
# fresh sign-in rate-limit bucket every time and an address of their choosing in
# every log line. `1` trusts exactly one hop — the balancer — so the address
# the app believes is the one the balancer actually saw.
set +x
db_url="$(aws ssm get-parameter --region '${region}' --name '${ssm_parameter_name}' \
  --with-decryption --query Parameter.Value --output text)"
touch /etc/inventory.env
chmod 0600 /etc/inventory.env
cat > /etc/inventory.env <<EOF
DATABASE_URL=$${db_url}
S3_BUCKET=${s3_bucket}
S3_REGION=${region}
APP_URL=${app_url}
TZ=${timezone}
%{ if trust_proxy ~}
TRUST_PROXY=1
%{ endif ~}
EOF
set -x

# --- The container -----------------------------------------------------------
%{ if ecr_registry != "" ~}
# A private ECR image needs a login; a public one does not, and this block is
# not rendered for it. The instance role carries exactly the four ecr: actions
# that make these two commands work.
aws ecr get-login-password --region '${ecr_region}' \
  | docker login --username AWS --password-stdin '${ecr_registry}'
%{ endif ~}
docker pull '${app_image}'

# `--restart=always` is what brings the app back after a reboot, so this script
# must not insist on creating a container that already exists.
if ! docker container inspect inventory > /dev/null 2>&1; then
  # A named volume rather than a host path: /data arrives owned by the image's
  # `node` user, which is what the container runs as and what its entrypoint
  # probes for at boot. Nothing durable lives there on this deployment — the
  # rows are in RDS and the attachments are in S3 — but the probe runs anyway,
  # so the mount has to be writable.
  #
  # json-file is Docker's default logging driver and it grows without bound.
  # The app writes a pino line per request onto a 30 GB root volume, and there
  # is no monitoring on this stack to notice it filling — so the cap goes here:
  # three files of 10 MB, oldest dropped, and the disk stops being a question.
  docker run -d --name inventory --restart=always \
    --log-opt max-size=10m --log-opt max-file=3 \
    --env-file /etc/inventory.env \
    -p 80:3000 \
    -v inventory-data:/data \
    -v '${rds_ca_path}':'${rds_ca_path}':ro \
    '${app_image}'
fi
