import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Uniqueness is case-insensitive via a hand-written expression index
 * (uq_asset_types_name_lower on lower(name)) added in the Init migration —
 * TypeORM decorators cannot express expression indexes.
 */
@Entity('asset_types')
export class AssetType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  /** Material icon name, e.g. 'laptop_mac'. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  icon: string | null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
