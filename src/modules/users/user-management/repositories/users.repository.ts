import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { User } from '../../../../entities/user.entity';

@Injectable()
export class UsersRepository {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  async findAll(): Promise<User[]> {
    return this.repo.find({
      relations: { role: true },
      order: { email: 'ASC' },
    });
  }

  async findById(id: number): Promise<User | null> {
    return this.repo.findOne({ where: { id }, relations: { role: true } });
  }

  /**
   * Emails are stored lowercased, but match case-insensitively anyway so a
   * row created before that rule (or by hand in Supabase) still resolves.
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.repo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .leftJoinAndSelect('role.permissions', 'permissions')
      .where('LOWER(user.email) = LOWER(:email)', { email })
      .getOne();
  }

  async countByRoleId(roleId: number): Promise<number> {
    return this.repo.count({ where: { role: { id: roleId } } });
  }

  /** Active users holding the given role, excluding one id (the one being changed). */
  async countActiveByRoleNameExcluding(
    roleName: string,
    excludeUserId: number,
  ): Promise<number> {
    return this.repo.count({
      where: {
        isActive: true,
        id: Not(excludeUserId),
        role: { name: roleName },
      },
      relations: { role: true },
    });
  }

  async save(user: User): Promise<User> {
    return this.repo.save(user);
  }

  async touchLastLogin(id: number, at: Date): Promise<void> {
    await this.repo.update(id, { lastLoginAt: at });
  }
}
