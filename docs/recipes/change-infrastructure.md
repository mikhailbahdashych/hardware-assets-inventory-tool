# Change the infrastructure

Six changes people actually make to the AWS deployment in [`infrastructure/`](../../infrastructure/README.md), each with the variable to touch, what `terraform plan` should say back, and the part that bites.

This is the one recipe where the tests are not the guard rail. Terraform is configuration: there is nothing to write a failing test against, and the only proof that a change is right is the plan you read before you apply it. **Reading the plan is the step.** A plan that says `must be replaced` where you expected `~` is the difference between a resize and an outage.

---

## Before any of them

```bash
cd infrastructure
terraform fmt -recursive     # not optional: CI runs `fmt -check`
terraform validate
terraform plan               # and then actually read it
```

**`fmt -check -recursive`, `init -backend=false` and `validate` are a CI job** (`terraform` in `.github/workflows/ci.yml`), on the same triggers as everything else. A pull request with an unformatted `.tf` file fails, in the same way an unformatted `.ts` file fails. `validate` needs no credentials and creates nothing — it checks that every resource, attribute and provider name in the stack exists.

Two things to know about the plan before you trust one:

- **The instance is disposable and the plan will happily say so.** `aws_instance.app` carries `user_data_replace_on_change = true`, so anything that changes the boot script — a new image tag, a new `APP_URL`, a new bucket name — replaces the machine. That is two or three minutes of downtime and no data loss, because the rows are in RDS and the attachments are in S3.
- **`aws_db_instance.main` being replaced is a different sentence entirely.** It means the live database is destroyed and a new empty one is created. Nothing in this recipe should ever produce that except [restoring from a snapshot](#5-restore-the-database-from-a-snapshot), and there it is the point. If you see it anywhere else, stop.

---

## 1. Resize the instance — `infrastructure/terraform.tfvars`

```hcl
instance_type = "t4g.medium"
```

**What the plan should show.** Within one architecture, an in-place update:

```
~ resource "aws_instance" "app" {
    ~ instance_type = "t4g.small" -> "t4g.medium"
  }
```

Terraform stops the instance, resizes it, and starts it again. The instance id survives, the Elastic IP stays put, and the container comes back on its own because it runs with `--restart=always`. A minute or two of downtime.

**Across architectures it is a replacement instead**, and that is correct rather than a mistake: `data.aws_ami.al2023` derives its architecture from `instance_type` (`ec2.tf`), so `t4g.small` → `t3.small` swaps the AMI to x86_64 in the same plan, and a different AMI is a different machine. You will see `# aws_instance.app must be replaced` and `~ ami = "ami-…" -> (known after apply)`. Nothing else has to change: there is no `architecture` variable to keep in step, deliberately.

**The step people forget:** t-family instances are burstable, and `t4g` launches in **unlimited** mode by default — so an instance that has been over its CPU baseline for weeks does not throttle, it quietly bills surplus credits. If you are resizing because of cost rather than speed, `CPUSurplusCreditsCharged` in CloudWatch is the metric that says whether a bigger instance is the fix or whether you have been paying for one all along.

## 2. Change the RDS class or its disk — `infrastructure/terraform.tfvars`

```hcl
db_instance_class    = "db.t4g.small"
db_allocated_storage = 50
```

**What the plan should show.** An in-place update on `aws_db_instance.main`, never a replacement:

```
~ instance_class    = "db.t4g.micro" -> "db.t4g.small"
~ allocated_storage = 20 -> 50
```

`apply_immediately = true` in `rds.tf` means both happen now rather than at the next maintenance window. Both cause a short outage — a class change is a reboot, a storage change is usually online but can be slow.

**The step people forget:** **storage only goes up.** RDS cannot shrink an allocated volume, so a `50` typed where you meant `20` is permanent short of a snapshot-restore into a new instance. And after a storage change RDS refuses another one for six hours; there is no way to hurry that.

## 3. Add the domain and TLS — `infrastructure/terraform.tfvars`

```hcl
domain          = "inventory.example.com"
route53_zone_id = "Z0123456789ABCDEFGHIJ"
```

Both or neither — `variables.tf` has a validation that refuses half, because a certificate with nowhere to prove itself hangs for forty-five minutes before failing.

**What gets created** (everything in `infrastructure/dns.tf`, all of it `count = local.domain_enabled ? 1 : 0`): an ACM certificate validated over DNS, the Route53 record that validates it, an Application Load Balancer across both public subnets, a target group on the instance's port 80, a listener on 443 with a 301 from 80, and the A alias. Plus one rule on the instance's own security group that lets the balancer in.

**What disappears at the same time:** `ec2.tf`'s two world-facing rules (`app_http`, `app_https`). With a balancer in front, the instance stops being reachable from the internet, and the plan will show both being destroyed. That is the design, not a gap.

**Where `APP_URL` changes:** `local.app_url` in `ec2.tf` flips from `http://<eip>` to `https://<domain>`, and `TRUST_PROXY=true` joins the environment file so the sign-in rate limits key on the client's address rather than the balancer's. Both are inside `user_data`, so **the plan will replace the instance** — expected, and the reason the whole thing is one apply and not three.

**The step people forget:** `APP_URL` is the origin guard's only input. Between the instance being replaced and DNS actually resolving to the balancer, anybody reaching the old address gets a 403 on every save, with no clue why. Have the record's TTL low before you start, and check `terraform output app_url` against your address bar afterwards — `www.` counts, the port counts, `http` versus `https` counts.

And read the honest label in `dns.tf`: **this half has never been applied.** Watch the first one.

## 4. Change region — `infrastructure/terraform.tfvars`

```hcl
region = "eu-west-1"
```

**What follows on its own.** `data.aws_ami.al2023` is a lookup, not a hardcoded id, so it finds that region's current AL2023 for the right architecture with no second edit. The S3 gateway endpoint's `service_name` is built from `var.region`. The bucket, the instance, the database, the parameter — all of them are created by the provider, which is configured with `var.region` in `providers.tf`.

**What does not follow, and is the whole point of this entry:** **this is not a move, it is a second deployment.** The plan will show every resource in the stack being destroyed and recreated — a new VPC, a new empty database, a new bucket with a new name, a new Elastic IP. No data crosses. If you have a live workspace in the old region, changing this variable throws it away.

To actually move regions: stand the new stack up beside the old one (`name_prefix = "inventory-fra"`, a separate state), restore an RDS snapshot into it, copy the bucket across with `aws s3 sync`, cut DNS over, then destroy the old one. That is a project, not a variable.

**The step people forget:** the availability zone names change with the region, and `data.aws_availability_zones` filters out Local Zones for you — but a region with fewer than two usable zones cannot host the RDS subnet group at all. And if `app_image` points at ECR, the registry has its own region baked into its hostname: the pull still works from anywhere, but it is now cross-region data transfer on every instance replacement.

## 5. Restore the database from a snapshot — `infrastructure/rds.tf`

Add one argument to `aws_db_instance.main`:

```hcl
snapshot_identifier = "inventory-db-2026-08-20-manual"
```

**What the plan should show — and this is the one time you want to see it:**

```
# aws_db_instance.main must be replaced
```

The current database is destroyed and a new one is created from the snapshot. Take a manual snapshot of what is there **now**, first, whatever state it is in — `skip_final_snapshot = true` means the destroy leaves nothing behind on its own:

```bash
aws rds create-db-snapshot --db-instance-identifier inventory-db \
  --db-snapshot-identifier inventory-db-before-restore
```

Then, in the same apply or the one after it, replace the instance too:

```bash
terraform apply -replace=aws_instance.app
```

The container reads `/etc/inventory.env` and that file is written once, by `user_data`, at first boot. A restored database can come back with a different endpoint host, and the running container would keep dialling the old one. Replacing the instance is what re-renders the file.

**The step people forget:** **the bucket is not in the snapshot.** An RDS restore rolls the rows back to Tuesday and leaves every attachment where it is, so rows will reference objects that were deleted since and objects will exist that no row names. The app's nightly sweep removes the second kind after 24 hours — which means a restore you do not follow up on quietly destroys the orphans it created. Versioning is on for the bucket; use it, or take the two backups together in the first place.

## 6. Rotate the database password

The password is generated by `random_password.db` (`rds.tf`) and exists in exactly two places: RDS itself, and the SSM SecureString at `/{name_prefix}/db-url`. Rotating it means moving both, and then making the instance re-read.

```bash
cd infrastructure
terraform apply -replace=random_password.db -replace=aws_instance.app
```

**What the plan should show:** `random_password.db` replaced, `aws_db_instance.main` updated in place (`~ password = (sensitive value)`), `aws_ssm_parameter.db_url` updated in place (`~ value = (sensitive value)`), and `aws_instance.app` replaced. Terraform orders them that way on its own, because the parameter interpolates the password and `user_data` interpolates the parameter's name.

**The step people forget — and it is the whole reason for the second `-replace`:** rotating without it leaves you with a stack that Terraform says is correct and an app that cannot connect. `user_data` runs **once**, at first boot; `/etc/inventory.env` still holds the old connection string, and rebooting the instance does not re-run cloud-init. The app keeps its pool alive on old connections for a while and then starts failing on new ones, hours later, for no visible reason.

If three minutes of downtime is more than you have, do it by hand over Session Manager instead — read the new value, rewrite the file, restart the container:

```bash
aws ssm start-session --target "$(terraform output -raw instance_id)"
# on the instance:
sudo -i
db_url="$(aws ssm get-parameter --with-decryption --output text \
  --query Parameter.Value --name /inventory/db-url)"
grep -v '^DATABASE_URL=' /etc/inventory.env > /etc/inventory.env.new
printf 'DATABASE_URL=%s\n' "$db_url" >> /etc/inventory.env.new
chmod 0600 /etc/inventory.env.new && mv /etc/inventory.env.new /etc/inventory.env
docker restart inventory
```

Rewrite the line rather than `sed`-ing it: the connection string carries `sslmode=verify-full&sslrootcert=…`, and an unescaped `&` in a `sed` replacement means "the whole match" — which produces a file that looks almost right.

Then run the `apply` without `-replace=aws_instance.app`, so state and reality agree.

---

## What this recipe is not for

**Changing what the app does.** Nothing in `infrastructure/` knows anything about assets, employees or roles. It produces `DATABASE_URL`, `S3_BUCKET`, `S3_REGION`, `APP_URL` and `TRUST_PROXY`, hands them to a container, and stops. If the change you want is a field or a page, you are in the wrong directory — the rest of `docs/recipes/` is where it lives.

**Deploying a new version.** That is `app_image` and an `apply`, described in [`infrastructure/README.md`](../../infrastructure/README.md#upgrading) with the honest note that it replaces the instance.

**Running it on one small machine.** That is [`docs/deployment.md`](../deployment.md) — one container, one volume, a reverse proxy, and none of this. It is still the right answer for most workspaces.
