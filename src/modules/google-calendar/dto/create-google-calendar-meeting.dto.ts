import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateGoogleCalendarMeetingDto {
  @IsOptional()
  @IsIn(['lead', 'task'])
  entityKind?: 'lead' | 'task';

  @IsOptional()
  @IsInt()
  @Min(1)
  entityId?: number;

  @IsString()
  @MaxLength(255)
  title: string;

  @IsISO8601()
  startsAt: string;

  @IsISO8601()
  endsAt: string;

  @IsString()
  @MaxLength(100)
  timeZone: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsEmail({}, { each: true })
  attendees?: string[];
}
