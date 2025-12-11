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

  @OneToMany(() => Contact, (contact) => contact.company)
  contacts: Contact[];
}
