import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Company } from './company.entity';
import { Lead } from './lead.entity';

@Entity('contacts')
@Index('ux_contacts_email_ci', ['email'])
@Index('ux_contacts_phone', ['phone'])
@Index('ux_contacts_name_ci', ['name'])
export class Contact {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100, nullable: true })
  name?: string;



  @Column({ length: 100, nullable: true })
  occupation?: string;

  @Column({ length: 50, nullable: true })
  phone?: string;

  @Column({ length: 100, nullable: true })
  email?: string;

  @Column({ length: 255, nullable: true })
  address?: string;

  @Column({ name: 'address_link', length: 500, nullable: true })
  addressLink?: string;

  @Column({ name: 'is_customer', default: false })
  customer: boolean;

  @Column({ name: 'is_client', default: false })
  client: boolean;

  @Column({ type: 'jsonb', nullable: true, name: 'notes' })
  notes?: string[];

  @ManyToOne(() => Company, (company) => company.contacts, { nullable: true })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @OneToMany(() => Lead, (lead) => lead.contact)
  leads: Lead[];
}
