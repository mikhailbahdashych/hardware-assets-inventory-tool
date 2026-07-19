import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMfaReplayGuard1784481057557 implements MigrationInterface {
  name = 'AddMfaReplayGuard1784481057557';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "mfa_last_used_step" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "mfa_last_used_step"`);
  }
}
