import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { toNoteActor } from '../note-management/services/note-access.service';
import type { NoteReferenceOrigin } from '../../../entities/note-reference.entity';
import { AddNoteRelationDto } from './dto/add-note-relation.dto';
import { ListReferencingNotesDto } from './dto/list-referencing-notes.dto';
import { SearchReferenceTargetsDto } from './dto/search-reference-targets.dto';
import { NoteReferencesService } from './note-references.service';

/**
 * Its own base path rather than more routes under /notes, because half of these are not
 * about a note at all: `/note-references/by-target` is asked by a lead page, and
 * `/note-references/targets` by the editor's mention menu before any note is involved.
 *
 * It also sidesteps the ordering trap that /notes already warns about — NotesController
 * declares `@Get(':id')`, which would swallow any static segment added after it, and
 * across two controllers that ordering would depend on the module's `controllers` array.
 */
@ApiTags('notes')
@Controller('note-references')
@RequirePermissions('notes:read')
export class NoteReferencesController {
  constructor(private readonly references: NoteReferencesService) {}

  @Get('targets')
  @ApiOperation({
    summary: 'Search referenceable records across the CRM, for the @ and [[ menus',
  })
  @ApiResponse({ status: 200, description: 'Returns matching records, capped per kind' })
  async searchTargets(
    @Query() query: SearchReferenceTargetsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.references.search(
      query.q ?? '',
      query.kinds ?? [],
      query.perKind ?? 5,
      toNoteActor(user),
    );
  }

  @Get('by-target')
  @ApiOperation({ summary: 'Notes referencing a given record' })
  @ApiResponse({
    status: 200,
    description: 'Returns the visible notes pointing at the record, with their context lines',
  })
  async listByTarget(
    @Query() query: ListReferencingNotesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.references.listNotesReferencing(
      query.kind,
      query.targetId,
      toNoteActor(user),
      (query.origins ?? []) as NoteReferenceOrigin[],
    );
  }

  @Get('page/:pageId')
  @ApiOperation({ summary: 'Everything a note points at, resolved to live labels' })
  @ApiParam({ name: 'pageId', type: Number })
  @ApiResponse({ status: 200, description: 'Returns the note outgoing references' })
  @ApiResponse({ status: 404, description: 'Note not found or not readable by this user' })
  async listForPage(
    @Param('pageId', ParseIntPipe) pageId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.references.listForPage(pageId, toNoteActor(user));
  }

  @Get('page/:pageId/backlinks')
  @ApiOperation({ summary: 'Notes that point at this note' })
  @ApiParam({ name: 'pageId', type: Number })
  @ApiResponse({ status: 200, description: 'Returns the visible notes linking here' })
  @ApiResponse({ status: 404, description: 'Note not found or not readable by this user' })
  async listBacklinks(
    @Param('pageId', ParseIntPipe) pageId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.references.listBacklinks(pageId, toNoteActor(user));
  }

  @Post('page/:pageId/relations')
  @RequirePermissions('notes:write')
  @ApiOperation({ summary: 'Pin a record to a note' })
  @ApiParam({ name: 'pageId', type: Number })
  @ApiResponse({ status: 201, description: 'Returns the note references after the change' })
  @ApiResponse({ status: 404, description: 'Note or target record not found' })
  async addRelation(
    @Param('pageId', ParseIntPipe) pageId: number,
    @Body() dto: AddNoteRelationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.references.addRelation(pageId, dto.kind, dto.targetId, toNoteActor(user));
  }

  /**
   * Only pinned relations can be removed here. An inline mention is deleted by deleting
   * the chip from the document — removing it from under the text would leave a chip
   * pointing at a reference that no longer exists, and the next autosave would write it
   * straight back.
   */
  @Delete('page/:pageId/relations/:kind/:targetId')
  @RequirePermissions('notes:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unpin a record from a note' })
  @ApiParam({ name: 'pageId', type: Number })
  @ApiParam({ name: 'kind', type: String })
  @ApiParam({ name: 'targetId', type: Number })
  @ApiResponse({ status: 204, description: 'The relation is gone' })
  async removeRelation(
    @Param('pageId', ParseIntPipe) pageId: number,
    @Param('kind') kind: string,
    @Param('targetId', ParseIntPipe) targetId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.references.removeRelation(pageId, kind, targetId, toNoteActor(user));
  }
}
