import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { InvitationCheckGuard } from '../../../common/guards/invitation-check.guard';
import { CheckInvitationDto } from './dto/check-invitation.dto';
import { UserInvitationsService } from './services/user-invitations.service';

@ApiTags('auth')
@Controller('auth/invitations')
export class AuthInvitationsController {
  constructor(private readonly invitations: UserInvitationsService) {}

  /**
   * Called server-side by the Next.js Google callback, which has verified an identity
   * but has no session yet — hence @Public() plus a shared secret rather than a
   * permission.
   *
   * It replaces the EXTERNAL_EMAIL_ALLOWLIST constant that used to live in that route.
   * The callback still has to let its own Workspace domain through first: internal
   * staff self-provision on first login, so until then they have no row here and this
   * answers `allowed: false` for them.
   */
  @Post('check')
  @Public()
  @UseGuards(InvitationCheckGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'May this Google account be given a session?' })
  @ApiResponse({ status: 200, description: '{ allowed, userId?, status? }' })
  async check(@Body() dto: CheckInvitationDto) {
    return this.invitations.checkAccess(dto.email);
  }
}
