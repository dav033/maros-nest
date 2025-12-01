import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('company_services')
export class CompanyService {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100, unique: true })
  name: string;

  @Column({ length: 7, nullable: true })
  color?: string;
}
