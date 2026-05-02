import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { CompanyType } from '../common/enums/company-type.enum';
import { Contact } from './contact.entity';

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 150 })
  name: string;

  @Column({ length: 255, nullable: true })
  address?: string;

  @Column({ name: 'address_link', length: 500, nullable: true })
  addressLink?: string;

  @Column({
    type: 'enum',
    enum: CompanyType,
    nullable: true,
  })
  type?: CompanyType;

  @Column({ name: 'service_id', nullable: true })
  serviceId?: number;

  @Column({ name: 'is_customer', default: false })
  customer: boolean;

  @Column({ name: 'is_client', default: false })
  client: boolean;

  @Column({ type: 'jsonb', nullable: true })
  notes?: string[];

  @Column({ length: 255, nullable: true })
  phone?: string;

  @Column({ length: 255, nullable: true })
  email?: string;

  @Column({ length: 255, nullable: true })
  submiz?: string;

  @Column({ name: 'qbo_vendor_id', length: 64, nullable: true })
  qboVendorId?: string;

  @Column({ name: 'qbo_vendor_name', length: 255, nullable: true })
  qboVendorName?: string;

  @Column({
    name: 'qbo_vendor_match_confidence',
    type: 'double precision',
    nullable: true,
  })
  qboVendorMatchConfidence?: number;

  @Column({ name: 'qbo_vendor_matched_at', type: 'timestamptz', nullable: true })
  qboVendorMatchedAt?: Date;

  @Column({
    name: 'qbo_vendor_last_synced_at',
    type: 'timestamptz',
    nullable: true,
  })
  qboVendorLastSyncedAt?: Date;

  @OneToMany(() => Contact, (contact) => contact.company)
  contacts: Contact[];
}
