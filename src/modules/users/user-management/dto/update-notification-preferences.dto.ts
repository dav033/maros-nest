import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { NotificationChannel } from '../../../../entities/user.entity';

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsIn(['in_app', 'email', 'none'])
  assignment?: NotificationChannel;

  @IsOptional()
  @IsIn(['in_app', 'email', 'none'])
  status?: NotificationChannel;

  @IsOptional()
  @IsIn(['in_app', 'email', 'none'])
  blocked?: NotificationChannel;

  @IsOptional()
  @IsIn(['in_app', 'email', 'none'])
  comment?: NotificationChannel;

  @IsOptional()
  @IsIn(['in_app', 'email', 'none'])
  mention?: NotificationChannel;

  @IsOptional()
  @IsIn(['in_app', 'email', 'none'])
  permit?: NotificationChannel;

  @IsOptional()
  @IsIn(['in_app', 'email', 'none'])
  digest?: NotificationChannel;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  digestHour?: number;
}
