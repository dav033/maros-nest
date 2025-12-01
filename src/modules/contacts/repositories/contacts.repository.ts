import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { Contact } from '../../../entities/contact.entity';

@Injectable()
export class ContactsRepository {
  constructor(
    @InjectRepository(Contact)
    private readonly repo: Repository<Contact>,
  ) {}

  async findByName(name: string): Promise<Contact | null> {
    return this.repo.findOne({ where: { name } });
  }

  async existsByNameIgnoreCase(name: string): Promise<boolean> {
    const count = await this.repo
      .createQueryBuilder('contact')
      .where('LOWER(contact.name) = LOWER(:name)', { name })
      .getCount();
    return count > 0;
  }

  async existsByNameIgnoreCaseAndIdNot(name: string, id: number): Promise<boolean> {
    const count = await this.repo
      .createQueryBuilder('contact')
      .where('LOWER(contact.name) = LOWER(:name)', { name })
      .andWhere('contact.id != :id', { id })
      .getCount();
    return count > 0;
  }

  async existsByEmailIgnoreCase(email: string): Promise<boolean> {
    const count = await this.repo
      .createQueryBuilder('contact')
      .where('LOWER(contact.email) = LOWER(:email)', { email })
      .getCount();
    return count > 0;
  }

  async existsByEmailIgnoreCaseAndIdNot(email: string, id: number): Promise<boolean> {
    const count = await this.repo
      .createQueryBuilder('contact')
      .where('LOWER(contact.email) = LOWER(:email)', { email })
      .andWhere('contact.id != :id', { id })
      .getCount();
    return count > 0;
  }

  async existsByPhone(phone: string): Promise<boolean> {
    const count = await this.repo.count({ where: { phone } });
    return count > 0;
  }

  async existsByPhoneAndIdNot(phone: string, id: number): Promise<boolean> {
    const count = await this.repo.count({ where: { phone, id: Not(id) } });
    return count > 0;
  }

  async findByCustomerTrue(): Promise<Contact[]> {
    return this.repo.find({ where: { customer: true } });
  }

  async findByClientTrue(): Promise<Contact[]> {
    return this.repo.find({ where: { client: true } });
  }

  async findByCompanyId(companyId: number): Promise<Contact[]> {
    return this.repo.find({ where: { company: { id: companyId } } });
  }

  // Expose standard methods if needed
  async save(contact: Contact): Promise<Contact> {
    return this.repo.save(contact);
  }

  async findOne(id: number): Promise<Contact | null> {
    return this.repo.findOne({ where: { id } });
  }
  
  async delete(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
