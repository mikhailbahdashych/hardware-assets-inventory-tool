import { MigrationInterface, QueryRunner } from 'typeorm';

const TYPES: Array<[name: string, icon: string]> = [
  ['Laptop', 'laptop_mac'],
  ['Desktop', 'desktop_windows'],
  ['Monitor', 'monitor'],
  ['Phone', 'smartphone'],
  ['Tablet', 'tablet_mac'],
  ['Peripheral', 'keyboard'],
  ['Server', 'dns'],
  ['Network Device', 'router'],
  ['Software License', 'key'],
  ['Other', 'devices_other'],
];

export class SeedAssetTypes1784405600000 implements MigrationInterface {
  name = 'SeedAssetTypes1784405600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, icon] of TYPES) {
      await queryRunner.query(
        `INSERT INTO "asset_types" ("name", "icon") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [name, icon],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "asset_types" WHERE "name" = ANY($1)`, [
      TYPES.map(([n]) => n),
    ]);
  }
}
