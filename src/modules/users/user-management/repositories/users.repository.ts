import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { User, NotificationPreferences } from '../../../../entities/user.entity';

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
   * Active colleagues, name and picture only — the people-picker in the share dialog.
   *
   * Explicitly not findAll(): that one joins roles and is gated behind `users:read`,
   * which members do not have. Selecting the columns here rather than mapping them
   * afterwards means role and status never leave the database in the first place.
   */
  async findActiveDirectory(): Promise<
    Array<Pick<User, 'id' | 'email' | 'name' | 'picture'>>
  > {
    return this.repo.find({
      where: { isActive: true },
      select: { id: true, email: true, name: true, picture: true },
      order: { name: 'ASC', email: 'ASC' },
    });
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

  async findNotificationPreferences(id: number): Promise<NotificationPreferences> {
    const user = await this.repo.findOne({ where: { id }, select: { id: true, notificationPreferences: true } });
    return user?.notificationPreferences ?? ({} as NotificationPreferences);
  }
}
