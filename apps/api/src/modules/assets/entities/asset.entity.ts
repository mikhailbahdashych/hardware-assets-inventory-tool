import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AssetStatus } from '@inventory/shared';
import { AssetType } from '../../asset-types/entities/asset-type.entity';

@Entity('assets')
export class Asset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('uq_assets_asset_tag', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  assetTag: string;

  /** Deliberately NOT unique — real-world serials are messy; duplicates surface as UI/import warnings. */
  @Index('ix_assets_serial_number')
  @Column({ type: 'varchar', length: 128, nullable: true })
  serialNumber: string | null;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  manufacturer: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  modelNumber: string | null;

  @ManyToOne(() => AssetType, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'asset_type_id' })
  assetType: AssetType;

  @Index('ix_assets_asset_type_id')
  @Column({ type: 'uuid' })
  assetTypeId: string;

  /** varchar by design (not a PG enum) so adding statuses needs no migration; 'assigned' is only ever set by checkout. */
  @Index('ix_assets_status')
  @Column({ type: 'varchar', length: 16, default: AssetStatus.AVAILABLE })
  status: AssetStatus;

  @Column({ type: 'date', nullable: true })
  purchaseDate: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  purchasePrice: string | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  purchaseCurrency: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  supplier: string | null;

  @Column({ type: 'date', nullable: true })
  warrantyExpiresAt: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
