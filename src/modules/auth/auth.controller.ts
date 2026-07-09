import { Controller, Post, Body, HttpCode, HttpStatus, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { timingSafeEqual } from 'crypto';

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
    // would capture `undefined`.
    const expectedPassword = process.env.AUTH_PASSWORD;
    if (!expectedPassword) {
      throw new InternalServerErrorException('AUTH_PASSWORD is not configured');
    }
    if (!this.passwordsMatch(body.password, expectedPassword)) {
      throw new UnauthorizedException('Invalid password');
    }
    return { success: true };
  }

  private passwordsMatch(provided: string, expected: string): boolean {
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    if (providedBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(providedBuf, expectedBuf);
  }
}
