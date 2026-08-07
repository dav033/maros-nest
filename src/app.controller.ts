import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Public — used as an uptime/health check by the hosting platform.
  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
