import { Controller, Post, Body, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

class LoginDto {
  @ApiProperty()
  @IsString()
  password: string;
}

const HARDCODED_PASSWORD = process.env.AUTH_PASSWORD || 'Maros2024!';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid password' })
  login(@Body() body: LoginDto) {
    if (body.password !== HARDCODED_PASSWORD) {
      throw new UnauthorizedException('Invalid password');
    }
    return { success: true };
  }
}
