import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1784405580329 implements MigrationInterface {
  name = 'Init1784405580329';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "email" character varying(255) NOT NULL, "password_hash" character varying(255), "provider" character varying(20) NOT NULL DEFAULT 'local', "display_name" character varying(120) NOT NULL, "role" character varying(16) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "must_change_password" boolean NOT NULL DEFAULT false, "mfa_enabled" boolean NOT NULL DEFAULT false, "mfa_enforced" boolean NOT NULL DEFAULT false, "mfa_secret" text, "mfa_verified_at" TIMESTAMP WITH TIME ZONE, "last_login_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_users_email" ON "users"  ("email") `);
    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "replaced_by_id" uuid, "ip" character varying(45), "user_agent" character varying(255), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_refresh_tokens_user_id" ON "refresh_tokens"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_refresh_tokens_token_hash" ON "refresh_tokens"  ("token_hash") `,
    );
    await queryRunner.query(
      `CREATE TABLE "mfa_recovery_codes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "code_hash" character varying(64) NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0076416b1b84361afc3371ba121" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_mfa_recovery_codes_user_id" ON "mfa_recovery_codes"  ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "employees" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "first_name" character varying(100) NOT NULL, "last_name" character varying(100) NOT NULL, "email" character varying(255), "employee_number" character varying(64), "department" character varying(120), "title" character varying(120), "notes" text, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b9535a98350d5b26e7eb0c26af4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_employees_email" ON "employees"  ("email") WHERE "email" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_employees_employee_number" ON "employees"  ("employee_number") WHERE "employee_number" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_employees_name" ON "employees"  ("last_name", "first_name") `,
    );
    await queryRunner.query(
      `CREATE TABLE "asset_types" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(80) NOT NULL, "description" character varying(255), "icon" character varying(40), "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2cf0314bcc4351b7f2827d57edb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "assets" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "asset_tag" character varying(64) NOT NULL, "serial_number" character varying(128), "name" character varying(200) NOT NULL, "manufacturer" character varying(120), "model_number" character varying(120), "asset_type_id" uuid NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'available', "purchase_date" date, "purchase_price" numeric(12,2), "purchase_currency" character varying(3), "supplier" character varying(200), "warranty_expires_at" date, "notes" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_da96729a8b113377cfb6a62439c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_assets_asset_tag" ON "assets"  ("asset_tag") `,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_assets_serial_number" ON "assets"  ("serial_number") `,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_assets_asset_type_id" ON "assets"  ("asset_type_id") `,
    );
    await queryRunner.query(`CREATE INDEX "ix_assets_status" ON "assets"  ("status") `);
    await queryRunner.query(
      `CREATE TABLE "assignments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "asset_id" uuid NOT NULL, "employee_id" uuid NOT NULL, "assigned_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "returned_at" TIMESTAMP WITH TIME ZONE, "assigned_by_id" uuid, "checked_in_by_id" uuid, "checkout_note" character varying(500), "checkin_note" character varying(500), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c54ca359535e0012b04dcbd80ee" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_assignments_employee" ON "assignments"  ("employee_id", "returned_at") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_assignments_open_asset" ON "assignments"  ("asset_id") WHERE "returned_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" BIGSERIAL NOT NULL, "actor_id" uuid, "actor_email" character varying(255), "action" character varying(20) NOT NULL, "entity_type" character varying(32), "entity_id" character varying(64), "before" jsonb, "after" jsonb, "metadata" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_audit_logs_created_at" ON "audit_logs"  ("created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_audit_logs_entity" ON "audit_logs"  ("entity_type", "entity_id") `,
    );
    // Hand-written: case-insensitive uniqueness for asset type names.
    // TypeORM decorators cannot express expression indexes — keep this in
    // sync manually if asset_types.name ever changes.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_asset_types_name_lower" ON "asset_types" (lower("name"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "FK_23aa6c5fdecdd98508fd4456acf" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "assets" ADD CONSTRAINT "FK_d43ed9e838f74bcc07b1266a8d6" FOREIGN KEY ("asset_type_id") REFERENCES "asset_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "assignments" ADD CONSTRAINT "FK_f38629a3327e8b7033ca15a6a0c" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "assignments" ADD CONSTRAINT "FK_bc4eb0a747d8a219de81111f379" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "assignments" ADD CONSTRAINT "FK_a76bdbfeb13c3a195855993eaa5" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "assignments" ADD CONSTRAINT "FK_03b0cb418a5bf7d29efd187b2b9" FOREIGN KEY ("checked_in_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_177183f29f438c488b5e8510cdb" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_177183f29f438c488b5e8510cdb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assignments" DROP CONSTRAINT "FK_03b0cb418a5bf7d29efd187b2b9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assignments" DROP CONSTRAINT "FK_a76bdbfeb13c3a195855993eaa5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assignments" DROP CONSTRAINT "FK_bc4eb0a747d8a219de81111f379"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assignments" DROP CONSTRAINT "FK_f38629a3327e8b7033ca15a6a0c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "assets" DROP CONSTRAINT "FK_d43ed9e838f74bcc07b1266a8d6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "mfa_recovery_codes" DROP CONSTRAINT "FK_23aa6c5fdecdd98508fd4456acf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4"`,
    );
    await queryRunner.query(`DROP INDEX "public"."ix_audit_logs_entity"`);
    await queryRunner.query(`DROP INDEX "public"."ix_audit_logs_created_at"`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP INDEX "public"."uq_assignments_open_asset"`);
    await queryRunner.query(`DROP INDEX "public"."ix_assignments_employee"`);
    await queryRunner.query(`DROP TABLE "assignments"`);
    await queryRunner.query(`DROP INDEX "public"."ix_assets_status"`);
    await queryRunner.query(`DROP INDEX "public"."ix_assets_asset_type_id"`);
    await queryRunner.query(`DROP INDEX "public"."ix_assets_serial_number"`);
    await queryRunner.query(`DROP INDEX "public"."uq_assets_asset_tag"`);
    await queryRunner.query(`DROP TABLE "assets"`);
    await queryRunner.query(`DROP INDEX "public"."uq_asset_types_name_lower"`);
    await queryRunner.query(`DROP TABLE "asset_types"`);
    await queryRunner.query(`DROP INDEX "public"."ix_employees_name"`);
    await queryRunner.query(`DROP INDEX "public"."uq_employees_employee_number"`);
    await queryRunner.query(`DROP INDEX "public"."uq_employees_email"`);
    await queryRunner.query(`DROP TABLE "employees"`);
    await queryRunner.query(`DROP INDEX "public"."ix_mfa_recovery_codes_user_id"`);
    await queryRunner.query(`DROP TABLE "mfa_recovery_codes"`);
    await queryRunner.query(`DROP INDEX "public"."uq_refresh_tokens_token_hash"`);
    await queryRunner.query(`DROP INDEX "public"."ix_refresh_tokens_user_id"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP INDEX "public"."uq_users_email"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
