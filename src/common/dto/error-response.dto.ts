import { ApiProperty } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ description: 'HTTP Status code' })
  statusCode: number;

  @ApiProperty({ description: 'Error message' })
  message: string | string[];

  @ApiProperty({ description: 'Error type/name' })
  error: string;

  @ApiProperty({ description: 'Timestamp of the error' })
  timestamp: string;

  @ApiProperty({ description: 'Request path' })
  path: string;
}
