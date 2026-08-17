import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTaskSavedViewDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsObject()
  state: Record<string, unknown>;

  @IsBoolean()
  @IsOptional()
  shared?: boolean;
}
