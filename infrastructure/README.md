# The full-scale deployment

Flat Terraform for the version of this app that has outgrown one container and one volume: a VPC, an EC2 instance running the same published image, RDS PostgreSQL for the rows, and a private S3 bucket for the attachments. Nothing in the application changes — `DATABASE_URL` picks the engine and `S3_BUCKET` picks the storage, and this stack is a machine for producing those two values correctly.

If one machine is still enough, it probably is: [`docs/deployment.md`](../docs/deployment.md) is the smaller, cheaper, more boring answer, and it is the one most workspaces should be running. Come here when the database has to be managed, when the attachments have outgrown a disk, or when a compliance line says the data cannot live on the same box as the app.

> **Before you apply anything, read [Tearing it down](#tearing-it-down).** The bucket is versioned, and a versioned bucket refuses to be deleted while a single object version is left in it — which is how a five-minute experiment becomes a stack you cannot remove without going and reading this file anyway. It is one variable. Know which one before you start.

No file here is a module and no file here has a `count` on it for cleverness's sake. One responsibility per file — `vpc.tf`, `ec2.tf`, `rds.tf`, `s3.tf`, `iam.tf`, `dns.tf` — because the person changing this is either an operator with a specific question or a Claude Code session that has been told to change one thing.

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
  │    (az a)             │ EC2 t4g.small    │    │
  │                       │  docker :80→3000 │    │
  │  public  10.0.1.0/24  │  + Elastic IP    │    │
  │    (az b, empty)      └────────┬─────────┘    │
  │                                │ 5432         │
  │  private 10.0.10.0/24 ┌────────┴─────────┐    │
  │  private 10.0.11.0/24 │ RDS PostgreSQL 17│    │
  │    (subnet group)     │  db.t4g.micro    │    │
  │                       └──────────────────┘    │
  │                                               │
  │  S3 gateway endpoint ── on both route tables  │
  └───────────────────────────────────────────────┘
                        │
                  S3 bucket (attachments, private, versioned)
                  SSM SecureString /inventory/db-url
```

**There is no NAT gateway, on purpose.** The instance sits in a public subnet with an Elastic IP, so its outbound traffic — the image pull, Session Manager, S3 — leaves through the internet gateway directly. A NAT gateway would cost about as much as the instance and buy this stack nothing: the one thing it would protect is a private instance, and a private instance cannot be reached by a browser either. The database is private and speaks to nobody but the instance's security group.

**The second public subnet is empty** until you turn on the domain module. An Application Load Balancer will not exist without subnets in two availability zones, so it is cheaper to create the subnet now than to renumber the VPC later. An empty subnet costs nothing.

**Attachment traffic takes the S3 gateway endpoint**, which is attached to both route tables. It is free, and it keeps the one thing that will actually grow off the instance's public path.

## Prerequisites

- Terraform ≥ 1.9 (CI pins 1.14.x).
- AWS credentials with enough rights to create everything above. This is not a least-privilege deployment role; it is an operator running `apply` from a laptop.
- The [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) for the AWS CLI, if you want a shell on the instance. There is no SSH key in this stack and no port 22 in any security group.
- A published image tag. The default is `ghcr.io/mikhailbahdashych/hardware-assets-inventory-tool:latest`; pin a real release in your `terraform.tfvars` so an upgrade is a decision rather than a reboot.

## Applying it

```bash
cd infrastructure
cp terraform.tfvars.example terraform.tfvars   # optional: every value has a default
terraform init
terraform apply
```

Ten to fifteen minutes, most of it RDS. When it finishes:

```bash
terraform output app_url
```

**Open that address and finish `/setup` before you tell anybody about it.** A fresh instance is empty and its first screen creates the organization and its first admin, then answers 409 to everyone else forever. Whoever gets there first is the admin.

If the address answers nothing for the first minute or two, that is `user_data` still working: it waits for the Elastic IP to be attached, installs Docker, downloads the RDS certificate bundle, reads the connection string out of SSM and starts the container. [When it does not work](#when-it-does-not-work) is at the bottom.

## Tearing it down

```bash
terraform apply  -var bucket_force_destroy=true
terraform destroy
```

Two commands, and the order matters. `force_destroy` is read from **state**, not from the command line at destroy time, so `terraform destroy -var bucket_force_destroy=true` on its own will still fail on a bucket with objects in it. The `apply` is what writes the flag down; the `destroy` is what uses it.

That flag deletes every attachment and every old version of every attachment, without asking. It is off by default for exactly that reason.

If you would rather empty the bucket yourself and leave the flag alone:

```bash
BUCKET="$(terraform output -raw bucket)"
aws s3 rm "s3://$BUCKET" --recursive        # current versions
aws s3api delete-objects --bucket "$BUCKET" --delete "$(
  aws s3api list-object-versions --bucket "$BUCKET" \
    --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}' --output json
)"                                          # old versions
aws s3api delete-objects --bucket "$BUCKET" --delete "$(
  aws s3api list-object-versions --bucket "$BUCKET" \
    --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}' --output json
)"                                          # and the delete markers
terraform destroy
```

Both `delete-objects` calls fail with a malformed-XML error when there is nothing left to delete, which means they worked. `terraform destroy` is the thing to believe.

**Nothing else survives a destroy.** The RDS instance is created with `skip_final_snapshot = true` and `deletion_protection = false`, so it leaves no snapshot behind and nothing refuses. That is the right default for a starter and the wrong one for production — see [Before you call it production](#before-you-call-it-production).

## Reaching the instance

There is no SSH. Session Manager is the door, and the instance role carries exactly the five actions that open it:

```bash
aws ssm start-session --target "$(terraform output -raw instance_id)"
```

You land as `ssm-user` with `sudo`. The three things worth knowing once you are there:

```bash
sudo docker logs -f inventory                  # the app: pino JSON, migrations, requests
sudo cat /var/log/cloud-init-output.log        # the boot script, traced line by line
sudo cat /etc/inventory.env                    # what the container actually runs with
```

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

| Variable               | Default            | What it is                                                                                                              |
| ---------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `region`               | `eu-central-1`     | Everything lives here. The AMI is looked up in it, so changing it needs no second edit.                                 |
| `name_prefix`          | `inventory`        | On every resource name and the `Project` tag. A second value gives you a second stack in one account.                   |
| `tags`                 | `{}`               | Merged into the provider's `default_tags`, on top of `Project` and `ManagedBy`.                                         |
| `vpc_cidr`             | `10.0.0.0/16`      | The four /24s are carved out of it.                                                                                     |
| `app_image`            | `ghcr.io/…:latest` | The container to run. An ECR hostname here grows the login and the four `ecr:` grants; a public registry needs neither. |
| `instance_type`        | `t4g.small`        | The AMI architecture follows it — `t3.small` picks the x86_64 AL2023 by itself.                                         |
| `db_instance_class`    | `db.t4g.micro`     | RDS class.                                                                                                              |
| `db_allocated_storage` | `20`               | GB. Raising it applies in place; lowering it is not a thing RDS can do.                                                 |
| `timezone`             | `UTC`              | `TZ` for the container. The nightly jobs run on wall-clock time.                                                        |
| `bucket_force_destroy` | `false`            | Whether `destroy` may delete a bucket with objects in it. See [Tearing it down](#tearing-it-down).                      |
| `domain`               | `null`             | A hostname here creates the certificate, the load balancer and the DNS record.                                          |
| `route53_zone_id`      | `null`             | The zone `domain` lives in. Both or neither — the stack refuses half.                                                   |

## Outputs

| Output               | What it is                                                              |
| -------------------- | ----------------------------------------------------------------------- |
| `app_url`            | Exactly what the instance runs with as `APP_URL`. Open it in a browser. |
| `instance_id`        | For `aws ssm start-session --target`.                                   |
| `rds_endpoint`       | `host:port`, private to the VPC.                                        |
| `bucket`             | The attachments bucket.                                                 |
| `ssm_parameter_name` | Where the connection string lives.                                      |

None of them is sensitive, deliberately. The one credential this stack generates is in SSM, which is an API call your IAM policy can refuse and CloudTrail records — unlike an output, which every `terraform output` and every CI log would have.

## Upgrading

```bash
terraform apply -var 'app_image=ghcr.io/mikhailbahdashych/hardware-assets-inventory-tool:0.2.0'
```

And now the honest part: **this replaces the instance.** The image tag is read by `user_data` at boot, `user_data` is part of what defines the instance, and `user_data_replace_on_change = true` means Terraform builds a new one rather than leaving a machine whose script no longer describes it. Two or three minutes of downtime, and the Elastic IP moves across, so the address does not change.

That is safe here precisely because the instance holds nothing. The rows are in RDS, the attachments are in S3, and the container's `/data` volume exists only because the image's entrypoint probes it for writability at boot. Migrations run at every start and are idempotent, so the new instance upgrades the schema on its way up.

If you would rather not replace the machine for a patch release, do it by hand over Session Manager — `docker pull`, `docker rm -f inventory`, `docker run` with the same flags `user_data` used — and then set `app_image` to match on your next `apply` so Terraform and reality agree. The replacement is the supported path; this is the one for the afternoon you cannot spare the three minutes.

## Backups

- **RDS keeps seven days of automated backups**, taken during its maintenance window, and point-in-time recovery within that window comes free with them. Storage up to the size of the database costs nothing.
- **The bucket is versioned**, so a deleted or overwritten attachment is recoverable until you expire the old versions. There is no lifecycle rule doing that for you — add one if the bill starts to show it.
- **There is no backup of the two together.** A restore that puts the database back to Tuesday and leaves the bucket at Friday will have rows pointing at objects and objects nothing points at; the app's nightly sweep removes the second kind after 24 hours. If that matters to you, snapshot the bucket's versions at the same time you take a manual RDS snapshot.
- Admin → Settings → **Export all data** is still there, and still not a backup — it holds no password hashes and no attachment bytes. It is a migration tool.

## Scaling up

Every one of these is a variable and a `terraform apply`:

- **A bigger instance**: `instance_type`. Within one architecture (`t4g.small` → `t4g.medium`) this is an in-place change — Terraform stops the instance, resizes it and starts it again, so the instance id and the Elastic IP both survive. Across architectures (`t4g` → `t3`) the AMI lookup follows the instance type, and a different AMI means a **replacement**. Read the plan: `~ instance_type` is the first case, `must be replaced` is the second.
- **A bigger database**: `db_instance_class`, and `db_allocated_storage` for the disk. Both apply immediately rather than waiting for a maintenance window — `apply_immediately = true` in `rds.tf` — which means both cause a short outage when you run them.
- **A real front door**: `domain` and `route53_zone_id`. See below.

What is _not_ a variable: a second instance. The scheduler runs in-process, so two of them would both fire the nightly jobs. Scale the machine, not the count — the same rule as the single-container deployment, for the same reason.

## The domain module

Set both and `dns.tf` wakes up:

```hcl
domain          = "inventory.example.com"
route53_zone_id = "Z0123456789ABCDEFGHIJ"
```

You get an ACM certificate validated over DNS, an Application Load Balancer across both public subnets, a target group pointing at the instance's port 80, a listener on 443 with a 301 from 80, and an A alias in the zone. Three things change on the instance at the same time: it stops accepting traffic from the world (only the load balancer's security group reaches its port 80), `APP_URL` becomes `https://<domain>`, and `TRUST_PROXY=true` is written into its environment so the sign-in rate limits see the client's address rather than the balancer's.

Because `APP_URL` changes, **turning this on replaces the instance** — same three minutes as an upgrade.

**This half has never been applied.** The default path — no domain, the app on its Elastic IP — is the one that gets stood up and torn down for real; the domain module was written and reviewed against the provider's documentation and not run. It is straightforward Terraform and there is nothing exotic in it, but treat the first `apply` with a domain as something to watch rather than something to trust, and expect to fix a detail or two. The certificate validation in particular waits on ACM seeing a DNS record, which is where a wrong zone id costs you forty-five minutes before it says so.

## Before you call it production

The defaults here are a starter's defaults: everything is arranged so that the stack goes up in fifteen minutes and comes down in two. Four lines is the difference.

1. **`deletion_protection = true`** in `rds.tf`. Off, today, so `destroy` works.
2. **`skip_final_snapshot = false`** in `rds.tf`, with a `final_snapshot_identifier`. Off, today, for the same reason.
3. **`multi_az = true`** in `rds.tf`, if an availability zone going away should not be an outage. It roughly doubles the database cost.
4. **Move the state.** It is local and git-ignored, which is right for one operator and wrong for two. Add a backend block to `providers.tf` and re-init:

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

Worth saying out loud: **there is no monitoring in here.** No CloudWatch alarms, no log shipping, no dashboard. The app's `/api/v1/healthz` runs a query before it answers and the image carries its own healthcheck, which is enough for a human to check; it is not enough for a machine to page you. That is deliberately somebody else's decision and not a default this repo should pick.

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

Call it **$40 a month** with a little data transfer, which is the number to quote. Two things move it materially: the domain module adds an Application Load Balancer at roughly $20 a month before LCUs, and `multi_az = true` roughly doubles the database lines. Reserved instances or a Savings Plan take about a third off the two compute lines if this is going to run for a year.

## When it does not work

**`app_url` answers nothing, minutes after the apply finished.** `user_data` is still running or it failed. Get on the instance and read `/var/log/cloud-init-output.log` — it is traced line by line, so the last line is the thing that broke. The two lines that write the connection string are deliberately not traced.

**Every save in the browser is a 403, and `/setup` refuses.** `APP_URL` does not match the address you are typing. The app compares every mutating request's `Origin` against it exactly and the 403 names the origin it expected. Compare `terraform output app_url` with your address bar, character for character — `www.` counts, the port counts, `http` versus `https` counts. If they disagree, something changed the instance's address without re-rendering `user_data`.

**The container logs say the database refused the connection.** Two candidates. `rds.force_ssl` is on by default for PostgreSQL 17, so a connection string without `sslmode=verify-full` gets nowhere — check that `/etc/inventory/rds-ca.pem` exists on the host and is mounted into the container. Or the security group: `rds.tf`'s ingress rule names the app's security group, so an instance that came up in a different one is an instance the database has never heard of.

**Attachments fail to upload with a credentials error.** The container reads its S3 credentials from the instance role through IMDS, which is one hop further away from inside Docker's bridge network than it is from the host. `metadata_options.http_put_response_hop_limit` is 2 in `ec2.tf` for exactly that; at the default of 1 the lookup times out.

**The apply fails on the AMI lookup.** The filter is `al2023-ami-2023*-<arch>` with the architecture derived from `instance_type`. An instance type that is neither arm64 nor x86_64, or a region with no AL2023, is the only way this misses.

**`destroy` fails on the bucket.** [Tearing it down](#tearing-it-down). It is the versioning.
