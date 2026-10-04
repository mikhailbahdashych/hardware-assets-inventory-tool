# The full-scale deployment

Flat Terraform for the version of this app that has outgrown one container and one volume: a VPC, an EC2 instance running the same published image, RDS PostgreSQL for the rows, and a private S3 bucket for the attachments. Nothing in the application changes — `DATABASE_URL` picks the engine and `S3_BUCKET` picks the storage, and this stack is a machine for producing those two values correctly.

If one machine is still enough, [`docs/deployment.md`](../docs/deployment.md) is the smaller, cheaper answer most workspaces should run. Come here when the database has to be managed, the attachments have outgrown a disk, or the data cannot live on the same box as the app.

> **Before you apply anything, read [Tearing it down](#tearing-it-down).** A versioned bucket refuses to be deleted while a single object version is left in it; the way out is one variable, applied before the destroy.

No modules, no clever `count`s: one responsibility per file (`vpc.tf`, `ec2.tf`, `rds.tf`, `s3.tf`, `iam.tf`), for an operator with a specific question or a session told to change one thing.

## What it creates

```
                    internet
                        │
                  ┌─────┴──────┐
                  │    IGW     │
                  └─────┬──────┘
  ┌───────────────────────────────────────────────┐
  │ VPC 10.0.0.0/16                               │
  │                                               │
  │  public  10.0.0.0/24  ┌──────────────────┐    │
  │                       │ EC2 t4g.small    │    │
  │                       │  docker :80→3000 │    │
  │                       │  + Elastic IP    │    │
  │                       └────────┬─────────┘    │
  │                                │ 5432         │
  │  private 10.0.10.0/24 ┌────────┴─────────┐    │
  │  private 10.0.11.0/24 │ RDS PostgreSQL 17│    │
  │    (subnet group)     │  db.t4g.micro    │    │
  │                       └──────────────────┘    │
  │                                               │
  │  S3 gateway endpoint ── on both route tables  │
  └───────────────────────────────────────────────┘
                        │
                  S3 bucket (attachments, private, versioned, TLS-only)
                  SSM SecureString /inventory/db-url
```

**There is no NAT gateway, on purpose.** The instance has a public subnet and an Elastic IP, so the image pull, Session Manager and S3 leave through the internet gateway; a NAT gateway would cost about as much as the instance and protect nothing a browser could still reach. The database is private and answers only the instance's security group.

**The stack ends at plain HTTP on the Elastic IP, on purpose.** The domain, the proxy, the VPN and the TLS in front of it are your own edge — every company already has one, and this stack refuses to guess at it. Point yours at the instance (`terraform output public_ip`) and set two variables so the app knows: `app_url` (what the address bar will say — the origin guard refuses every save whose Origin differs) and `trust_proxy` (the edge's address or CIDR, so the sign-in rate limits see clients rather than the edge). Two honest limits of that arrangement: the instance stays reachable directly until you narrow the two ingress rules in `ec2.tf` to the edge's address, and an edge outside AWS reaches the instance over plain HTTP across the internet — if that hop matters, terminate TLS on the box instead. No edge yet? Port 443 is already open for exactly that — [`docs/deployment.md`](../docs/deployment.md) has the Caddy block.

**Attachment traffic takes the S3 gateway endpoint** on both route tables — free, and off the public path. **The instance may touch only `uploads/` in that bucket, and only over TLS.** Its role's grants stop at the prefix the app writes and lists (`iam.tf`, agreeing with `KEY_PREFIX` in `apps/api/src/services/storage.ts`), and the bucket policy denies any request that did not arrive over TLS — `aws:SecureTransport` false — (`s3.tf`). Neither costs a legitimate request anything; both turn a habit into a rule.

## Prerequisites

- Terraform ≥ 1.9 (CI pins 1.14.x).
- AWS credentials with enough rights to create everything above. This is not a least-privilege deployment role; it is an operator running `apply` from a laptop.
- The [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) for the AWS CLI, if you want a shell on the instance. There is no SSH key in this stack and no port 22 in any security group.
- An image tag that exists. The default, `ghcr.io/mikhailbahdashych/hardware-assets-inventory-tool:latest`, is one — but pin a release (`:X.Y.Z` — the newest `vX.Y.Z` on the repository's [packages page](https://github.com/mikhailbahdashych/hardware-assets-inventory-tool/pkgs/container/hardware-assets-inventory-tool), `:0.3.0` as of this writing) rather than track a moving tag, so an upgrade is a decision rather than a reboot. An older tag than the one you run is a downgrade, and migrations do not run backwards. An apply against a tag that does not exist _succeeds_ while leaving you nothing to open; [Applying it](#applying-it) has the symptom.

## Applying it

```bash
cd infrastructure
cp terraform.tfvars.example terraform.tfvars   # optional: every value has a default
terraform init
terraform apply
```

About ten minutes, most of it RDS — the last measured apply (27 September 2026) took 8m43s, 8m17s of it the database. When it finishes:

```bash
terraform output app_url
```

**It answers nothing for about another 90 seconds** while `user_data` waits for the Elastic IP, installs Docker, fetches the RDS certificate bundle, reads the connection string from SSM and starts the container. Then **open it and finish `/setup` before you tell anybody**: the first screen creates the organization and its first admin, and whoever gets there first is the admin.

**The likeliest surprise: an `app_image` tag that does not exist.** Terraform does not pull the image — `user_data` does, after Terraform has finished — so the apply **succeeds**, prints an `app_url`, and leaves an address that answers nothing. `/var/log/cloud-init-output.log` on the instance says `manifest unknown`. Use a published release, or your own build in ECR (`docker build --platform linux/arm64`, push, set `app_image` to the URI — the instance role grows the pull grants by itself).

## Tearing it down

```bash
terraform apply  -var bucket_force_destroy=true
terraform destroy
```

Two commands, in that order. `force_destroy` is read from **state**, so `terraform destroy -var bucket_force_destroy=true` on its own still fails on a bucket with objects in it: the `apply` writes the flag down, the `destroy` uses it. The flag deletes every attachment and every old version without asking, which is why it is off by default. The apply's plan says **3 to change** (two policy documents that name the bucket are re-read) but applies `1 changed`, the bucket. The last measured destroy (27 September 2026) took 2m32s.

`bucket_force_destroy = true` empties the bucket correctly in one pass. To look at what you are deleting first and leave the flag alone, empty it yourself — every version and delete marker, a page at a time, because one `delete-objects` call caps at 1000 keys and past that deletes **nothing**:

```bash
BUCKET="$(terraform output -raw bucket)"
while true; do
  VERSIONS="$(aws s3api list-object-versions --bucket "$BUCKET" --max-items 1000 \
    --query '{Objects: [Versions, DeleteMarkers][][].{Key:Key,VersionId:VersionId}}' --output json)"
  echo "$VERSIONS" | grep -q '"Key"' || break
  aws s3api delete-objects --bucket "$BUCKET" --delete "$VERSIONS" > /dev/null || break
done
terraform destroy
```

**Nothing else survives a destroy.** The RDS instance is created with `skip_final_snapshot = true` and `deletion_protection = false`, so it leaves no final snapshot behind and nothing refuses. Its last _automated_ snapshot does stay listed as `available` in the console for a few minutes after `destroy` returns — about six, measured — and then goes on its own; it is RDS cleaning up, not something the stack left. That is the right default for a starter and the wrong one for production — see [Before you call it production](#before-you-call-it-production).

## Reaching the instance

There is no SSH. Session Manager is the door, and the instance role carries exactly the five actions that open it. (Validation runs have used `ssm send-command`, below, which goes through the same grants; an interactive session has not yet been exercised against this stack.)

```bash
aws ssm start-session --target "$(terraform output -raw instance_id)"
```

No Session Manager plugin — a fresh machine has none — and the AWS CLI alone can still read the logs, by running one command on the instance and fetching its output:

```bash
ID="$(terraform output -raw instance_id)"
CMD="$(aws ssm send-command --instance-ids "$ID" --document-name AWS-RunShellScript \
  --parameters 'commands=["docker logs --tail 50 inventory 2>&1"]' \
  --query Command.CommandId --output text)"
sleep 5
aws ssm get-command-invocation --command-id "$CMD" --instance-id "$ID" \
  --query StandardOutputContent --output text
```

With a session, you land as `ssm-user` with `sudo`. The three things worth knowing once you are there:

```bash
sudo docker logs -f inventory                  # the app: pino JSON, requests, and the boot line below
sudo cat /var/log/cloud-init-output.log        # the boot script, traced line by line
sudo cat /etc/inventory.env                    # what the container actually runs with
```

The first JSON line of every boot is `"msg":"database and storage engaged"`, and on this stack it should say `"engine":"postgres"`, the RDS host and database (never the password), `"storage":"s3"` with the bucket, and `migrationsApplied` — how many migrations that boot ran. If it says `sqlite` or `local`, the env file is not what this stack wrote.

The database is private to the VPC, so reaching it from a laptop means tunnelling through the instance:

```bash
aws ssm start-session --target "$(terraform output -raw instance_id)" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "host=<the host part of rds_endpoint>,portNumber=5432,localPortNumber=5432"
```

The connection string, password and all, is in SSM and nowhere else this stack can show you:

```bash
aws ssm get-parameter --with-decryption --output text --query Parameter.Value \
  --name "$(terraform output -raw ssm_parameter_name)"
```

## Variables

| Variable               | Default            | What it is                                                                                                                                                                                                     |
| ---------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `region`               | `eu-central-1`     | Everything lives here. The AMI is looked up in it, so changing it needs no second edit.                                                                                                                        |
| `name_prefix`          | `inventory`        | On every resource name and the `Project` tag. A second value gives you a second stack in one account.                                                                                                          |
| `tags`                 | `{}`               | Merged into the provider's `default_tags`, on top of `Project` and `ManagedBy`.                                                                                                                                |
| `vpc_cidr`             | `10.0.0.0/16`      | The three /24s are carved out of it.                                                                                                                                                                           |
| `app_image`            | `ghcr.io/…:latest` | The container to run. An ECR hostname here grows the login and the four `ecr:` grants; a public registry needs neither.                                                                                        |
| `instance_type`        | `t4g.small`        | The AMI architecture follows it — `t3.small` picks the x86_64 AL2023 by itself.                                                                                                                                |
| `db_instance_class`    | `db.t4g.micro`     | RDS class.                                                                                                                                                                                                     |
| `db_allocated_storage` | `20`               | GB, and a floor: `rds.tf` autoscales it up to 100 GB or twice this value, whichever is larger, rather than let a full volume stop the app. Raising it applies in place; lowering it is not a thing RDS can do. |
| `timezone`             | `UTC`              | `TZ` for the container. The nightly jobs run on wall-clock time.                                                                                                                                               |
| `bucket_force_destroy` | `false`            | Whether `destroy` may delete a bucket with objects in it. See [Tearing it down](#tearing-it-down).                                                                                                             |
| `app_url`              | `null`             | Only with your own edge in front: the public address browsers use. The origin guard compares every save against it. Null means the front door is `http://<the EIP>`. Changing it replaces the instance.        |
| `trust_proxy`          | `null`             | Only with your own edge in front: its address or CIDR, so rate limits key on clients. An address, never `true`, never a hop count — the app refuses one at boot.                                               |

## Outputs

| Output               | What it is                                                              |
| -------------------- | ----------------------------------------------------------------------- |
| `app_url`            | Exactly what the instance runs with as `APP_URL`. Open it in a browser. |
| `public_ip`          | The Elastic IP — what your own edge forwards to.                        |
| `instance_id`        | For `aws ssm start-session --target`.                                   |
| `rds_endpoint`       | `host:port`, private to the VPC.                                        |
| `bucket`             | The attachments bucket.                                                 |
| `ssm_parameter_name` | Where the connection string lives.                                      |

None of them is sensitive, deliberately. The one credential this stack generates is in SSM, which is an API call your IAM policy can refuse and CloudTrail records — unlike an output, which every `terraform output` and every CI log would have.

## Upgrading

```bash
terraform apply -var 'app_image=ghcr.io/mikhailbahdashych/hardware-assets-inventory-tool:X.Y.Z'
```

`X.Y.Z` is the release you are moving to — the newest `vX.Y.Z` on the packages page, and never one older than what runs now. Read its [release notes](https://github.com/mikhailbahdashych/hardware-assets-inventory-tool/releases) first.

And now the honest part: **this replaces the instance.** The image tag is read by `user_data` at boot, `user_data` is part of what defines the instance, and `user_data_replace_on_change = true` means Terraform builds a new one rather than leaving a machine whose script no longer describes it. Two or three minutes of downtime, and the Elastic IP moves across, so the address does not change.

That is safe because the instance holds nothing: the rows are in RDS, the attachments in S3, and `/data` exists only because the entrypoint probes it. Migrations run at every start, so the new instance upgrades the schema on its way up — the path, including from v0.1.0 and v0.2.0, is in the deployment guide's [Upgrades](../docs/deployment.md#upgrades).

If you would rather not replace the machine for a patch release, do it by hand over Session Manager — `docker pull`, `docker rm -f inventory`, `docker run` with the same flags `user_data` used — and then set `app_image` to match on your next `apply` so Terraform and reality agree. The replacement is the supported path; this is the one for the afternoon you cannot spare the three minutes.

## Backups

- **RDS keeps seven days of automated backups**, taken during its maintenance window, and point-in-time recovery within that window comes free with them. Storage up to the size of the database costs nothing.
- **The bucket is versioned**, so a deleted or overwritten attachment is recoverable until you expire the old versions. There is no lifecycle rule doing that for you — add one if the bill starts to show it.
- **There is no backup of the two together**, and the JSON export is not a backup at all — [`docs/backup-restore.md`](../docs/backup-restore.md#postgresql-and-s3) says what a restore of one without the other leaves behind.

## Scaling up

Every one of these is a variable and a `terraform apply`:

- **A bigger instance**: `instance_type`. Within one architecture it is an in-place stop–resize–start that keeps the id and the Elastic IP; across architectures (`t4g` → `t3`) the AMI follows and the instance is **replaced** — as it also is whenever a newer AL2023 has shipped, which is how the stack gets OS patches. Either costs the same three minutes as an upgrade. [`change-infrastructure.md`](../docs/recipes/change-infrastructure.md) shows both plans.
- **A bigger database**: `db_instance_class`, and `db_allocated_storage` for the disk. Both apply immediately rather than waiting for a maintenance window — `apply_immediately = true` in `rds.tf` — which means both cause a short outage when you run them.

What is _not_ a variable: a second instance. The scheduler runs in-process, so two of them would both fire the nightly jobs. Scale the machine, not the count — the same rule as the single-container deployment, for the same reason.

## Before you call it production

The defaults here are a starter's defaults: everything is arranged so that the stack goes up in about ten minutes and comes down in about three. One of the differences is a decision; the rest are four lines.

1. **Put TLS in front of it.** This is the one that is not a line, and it is first because the default is worse than it looks: the app answers on a public IP over **plain HTTP** — and that is the transport for `/setup`, for every sign-in, and for the session cookie that comes back. Anyone on the path reads the admin password. Put your company's own edge in front and set `app_url` and `trust_proxy` to match, or terminate TLS on the instance yourself ([`docs/deployment.md`](../docs/deployment.md) has the Caddy block, and port 443 is already open for it). Until you do, treat the address as something to finish setup on and not something to hand around.
2. **`deletion_protection = true`** in `rds.tf`. Off, today, so `destroy` works.
3. **`skip_final_snapshot = false`** in `rds.tf`, with a `final_snapshot_identifier`. Off, today, for the same reason.
4. **`multi_az = true`** in `rds.tf`, if an availability zone going away should not be an outage. It roughly doubles the database cost.
5. **Move the state.** It is local and git-ignored, which is right for one operator and wrong for two. Add a backend block to `providers.tf` and re-init:

   ```hcl
   terraform {
     backend "s3" {
       bucket       = "your-terraform-state"
       key          = "inventory/terraform.tfstate"
       region       = "eu-central-1"
       encrypt      = true
       use_lockfile = true
     }
   }
   ```

   ```bash
   terraform init -migrate-state
   ```

   The state holds the database password in the clear — that is what Terraform state is, not a flaw in this stack — so the bucket it moves to should be private, versioned and encrypted.

**There is no monitoring in here** — no alarms, no log shipping. `/api/v1/healthz` and the image's own healthcheck are enough for a human to check, not for a machine to page you; that is your decision, deliberately.

## What it costs

On-demand list prices in `eu-central-1`, at 730 hours a month, **checked 23 August 2026**. Your bill will differ — this is arithmetic, not a quote.

| Line                                        | Rate            | Per month |
| ------------------------------------------- | --------------- | --------- |
| EC2 `t4g.small`                             | $0.0192 / h     | $14.02    |
| 30 GB gp3 root volume                       | $0.0952 / GB-mo | $2.86     |
| Elastic IP (all public IPv4 is charged now) | $0.005 / h      | $3.65     |
| RDS `db.t4g.micro`, PostgreSQL, single-AZ   | $0.019 / h      | $13.87    |
| 20 GB RDS gp3 storage                       | $0.137 / GB-mo  | $2.74     |
| Automated backups, up to the database size  | free            | $0        |
| S3 storage and requests, VPC endpoint       | pennies         | ~$0       |
| **Total**                                   |                 | **~$37**  |

Both t-family lines are burstable and launch in **unlimited** mode, so sustained load past the CPU baseline does not throttle — it bills surplus credits on top of the hourly rate above. Call it **$40 a month** with a little data transfer, which is the number to quote. One thing moves it materially: `multi_az = true` roughly doubles the database lines. Reserved instances or a Savings Plan take about a third off the two compute lines if this is going to run for a year.

## When it does not work

**The address answers nothing and the container keeps restarting.** `app_url` or `trust_proxy` is not a value the app accepts — it refuses at boot, and `--restart=always` retries forever. `sudo docker logs inventory` (over Session Manager) names the variable and what to write instead.

**`app_url` answers nothing, minutes after the apply finished.** `user_data` is still running or it failed. Get on the instance and read `/var/log/cloud-init-output.log` — it is traced line by line, so the last line is the thing that broke. The two lines that write the connection string are deliberately not traced.

**Every save in the browser is a 403, and `/setup` refuses.** `APP_URL` does not match the address you are typing. The app compares every mutating request's `Origin` against it exactly and the 403 names the origin it expected. Compare `terraform output app_url` with your address bar, character for character — `www.` counts, the port counts, `http` versus `https` counts. If they disagree, something changed the instance's address without re-rendering `user_data`.

**The container logs say the database refused the connection.** Two candidates. `rds.force_ssl` is on by default for PostgreSQL 17, so a connection string without `sslmode=verify-full` gets nowhere — check that `/etc/inventory/rds-ca.pem` exists on the host and is mounted into the container. Or the security group: `rds.tf`'s ingress rule names the app's security group, so an instance that came up in a different one is an instance the database has never heard of.

**Attachments fail to upload with a credentials error.** The container reads its S3 credentials from the instance role through IMDS, which is one hop further away from inside Docker's bridge network than it is from the host. `metadata_options.http_put_response_hop_limit` is 2 in `ec2.tf` for exactly that; at the default of 1 the lookup times out.

**The apply fails on the AMI lookup.** The filter is `al2023-ami-2023*-<arch>` with the architecture derived from `instance_type`. An instance type that is neither arm64 nor x86_64, or a region with no AL2023, is the only way this misses.

**`destroy` fails on the bucket.** [Tearing it down](#tearing-it-down). It is the versioning.
