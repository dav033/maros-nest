import { Controller, Post, Body, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

class LoginDto {
  @ApiProperty()
  @IsString()
  password: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid password' })
  login(@Body() body: LoginDto) {
    // Read at request time: process.env is populated by ConfigModule during
    // bootstrap, after module imports are evaluated — a module-level const here
    // would capture `undefined` and fall back to the hardcoded default.
    const expectedPassword = process.env.AUTH_PASSWORD || 'Maros2024!';
    if (body.password !== expectedPassword) {
      throw new UnauthorizedException('Invalid password');
    }
    return { success: true };
  }
}
