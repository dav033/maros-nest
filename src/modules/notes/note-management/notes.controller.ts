import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { NotesService } from './notes.service';
import { NoteTagsService } from './services/note-tags.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { UpdateNoteContentDto } from './dto/update-note-content.dto';
import { MoveNoteDto } from './dto/move-note.dto';
import { SetFavoriteDto } from './dto/set-favorite.dto';
import { SetTagsDto } from './dto/set-tags.dto';
import { SetEntityDto } from './dto/set-entity.dto';
import { SearchNotesDto } from './dto/search-notes.dto';
import { CreateTagDto } from './dto/create-tag.dto';
import { UpdateTagDto } from './dto/update-tag.dto';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { toNoteActor } from './services/note-access.service';
import { NoteSharingService } from '../note-sharing/note-sharing.service';
import { SetVisibilityDto } from './dto/set-visibility.dto';
import { CreateNoteShareDto } from './dto/create-note-share.dto';
import { UpdateNoteShareDto } from './dto/update-note-share.dto';
import { CreateNoteLinkDto } from './dto/create-note-link.dto';
import { UpdateNoteLinkDto } from './dto/update-note-link.dto';

@ApiTags('notes')
@Controller('notes')
// Class-level default; write/delete routes override it below.
@RequirePermissions('notes:read')
export class NotesController {
  constructor(
    private readonly notesService: NotesService,
    private readonly noteTagsService: NoteTagsService,
    private readonly sharingService: NoteSharingService,
  ) {}

  // --- Static routes first: they must never be shadowed by ':id'. ---

  @Get()
  @ApiOperation({ summary: 'Get all note pages (flat list, no content)' })
  @ApiResponse({ status: 200, description: 'Returns all active note pages' })
  async getAllNotes(@CurrentUser() user: AuthenticatedUser) {
    return this.notesService.getAllNotes(toNoteActor(user));
  }

  @Get('by-entity')
  @ApiOperation({ summary: 'Get note pages linked to a CRM entity' })
  @ApiQuery({ name: 'entityKind', enum: ['lead', 'project', 'contact', 'company'] })
  @ApiQuery({ name: 'entityId', type: Number })
  @ApiResponse({ status: 200, description: 'Returns note pages linked to the given entity' })
  async getNotesByEntity(
    @Query('entityKind') entityKind: string,
    @Query('entityId', ParseIntPipe) entityId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notesService.getNotesByEntity(entityKind, entityId, toNoteActor(user));
  }

  @Get('trash')
  @ApiOperation({ summary: 'Get trashed note pages (top-level of each trashed subtree)' })
  @ApiResponse({ status: 200, description: 'Returns trashed note pages' })
  async getTrash(@CurrentUser() user: AuthenticatedUser) {
    return this.notesService.getTrash(toNoteActor(user));
  }

  @Get('favorites')
  @ApiOperation({ summary: 'Get favorite note pages' })
  @ApiResponse({ status: 200, description: 'Returns favorite note pages' })
  async getFavorites(@CurrentUser() user: AuthenticatedUser) {
    return this.notesService.getFavorites(toNoteActor(user));
  }

  @Get('shared-with-me')
  @ApiOperation({ summary: 'Notes another user granted me access to' })
  @ApiResponse({
    status: 200,
    description:
      'Only pages reachable through a grant — anything already visible as a team ' +
      'page, or owned by the caller, is left out',
  })
  async getSharedWithMe(@CurrentUser() user: AuthenticatedUser) {
    return this.notesService.getSharedWithMe(toNoteActor(user));
  }

  @Get('links')
  @RequirePermissions('users:write')
  @ApiOperation({ summary: 'Every live public share link in the workspace (admin)' })
  @ApiResponse({
    status: 200,
    description:
      'The panic button for the day somebody leaves and nobody remembers what they published',
  })
  async listAllShareLinks() {
    return this.sharingService.listAllActiveLinks();
  }

  @Delete('links/:linkId')
  @RequirePermissions('users:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Emergency revoke of any public note link (admin)' })
  async adminRevokeShareLink(
    @Param('linkId', ParseIntPipe) linkId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.sharingService.revokeLinkAsAdmin(linkId, toNoteActor(user));
  }

  @Get('search')
  @ApiOperation({ summary: 'Full-text search over note titles and content' })
  @ApiResponse({ status: 200, description: 'Returns matching note pages, ranked' })
  async searchNotes(
    @Query() query: SearchNotesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notesService.searchNotes(query.q, query.limit ?? 20, toNoteActor(user));
  }

  @Get('tags')
  @ApiOperation({ summary: 'Get all note tags' })
  @ApiResponse({ status: 200, description: 'Returns all note tags' })
  async listTags() {
    return this.noteTagsService.listTags();
  }

  @Post('tags')
  @RequirePermissions('notes:write')
  @ApiOperation({ summary: 'Create a note tag' })
  @ApiResponse({ status: 201, description: 'Tag created successfully' })
  @ApiResponse({ status: 409, description: 'A tag with this name already exists' })
  async createTag(@Body() dto: CreateTagDto) {
    return this.noteTagsService.createTag(dto);
  }

  @Put('tags/:tagId')
  @RequirePermissions('notes:write')
  @ApiOperation({ summary: 'Update a note tag' })
  @ApiParam({ name: 'tagId', type: Number })
  @ApiResponse({ status: 200, description: 'Tag updated successfully' })
  @ApiResponse({ status: 404, description: 'Tag not found' })
  async updateTag(
    @Param('tagId', ParseIntPipe) tagId: number,
    @Body() dto: UpdateTagDto,
  ) {
    return this.noteTagsService.updateTag(tagId, dto);
  }

  @Delete('tags/:tagId')
  @RequirePermissions('notes:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a note tag' })
  @ApiParam({ name: 'tagId', type: Number })
  @ApiResponse({ status: 204, description: 'Tag deleted successfully' })
  @ApiResponse({ status: 404, description: 'Tag not found' })
  async deleteTag(@Param('tagId', ParseIntPipe) tagId: number) {
    await this.noteTagsService.deleteTag(tagId);
  }

  @Post()
  @RequirePermissions('notes:write')
  @ApiOperation({ summary: 'Create a note page' })
  @ApiResponse({ status: 201, description: 'Note page created successfully' })
  async createNote(
    @Body() dto: CreateNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notesService.createNote(dto, toNoteActor(user));
  }

  // --- ':id' routes below this point. ---

  @Get(':id')
  @ApiOperation({ summary: 'Get a note page by id, including its content' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Returns the note page' })
  @ApiResponse({ status: 404, description: 'Note page not found' })
  async getNoteById(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notesService.getNoteById(id, toNoteActor(user));
  }

  @Put(':id')
  @RequirePermissions('notes:write')
  @ApiOperation({ summary: 'Update note page title/icon' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Note page updated successfully' })
  @ApiResponse({ status: 404, description: 'Note page not found' })
  async updateNote(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notesService.updateNote(id, dto, toNoteActor(user));
  }

  @Patch(':id/content')
  @RequirePermissions('notes:write')
  @ApiOperation({ summary: 'Update note page content (autosave fast path)' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Note page content updated successfully' })
  @ApiResponse({ status: 404, description: 'Note page not found' })
  @ApiResponse({ status: 409, description: 'Content was modified since it was last loaded' })
  async updateNoteContent(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateNoteContentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notesService.updateNoteContent(id, dto, toNoteActor(user));
  }

  @Patch(':id/move')
  @RequirePermissions('notes:write')
  @ApiOperation({ summary: 'Move/reorder a note page in the tree' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Note page moved successfully' })
  @ApiResponse({ status: 404, description: 'Note page or target not found' })
  @ApiResponse({ status: 422, description: 'Move would create a cycle' })
  async moveNote(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MoveNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notesService.moveNote(id, dto, toNoteActor(user));
  }

  @Patch(':id/favorite')
  @RequirePermissions('notes:write')
  @ApiOperation({ summary: 'Mark/unmark a note page as favorite' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Favorite state updated' })
  async setFavorite(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetFavoriteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notesService.setFavorite(id, dto.isFavorite, toNoteActor(user));
  }

  @Patch(':id/entity')
  @RequirePermissions('notes:write')
  @ApiOperation({ summary: 'Link the note to a CRM entity, or clear the link' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Entity link updated' })
  @ApiResponse({ status: 404, description: 'Note page not found' })
  async setEntityLink(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetEntityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notesService.setEntityLink(id, dto, toNoteActor(user));
  }

  @Patch(':id/tags')
  @RequirePermissions('notes:write')
  @ApiOperation({ summary: 'Set the complete tag list for a note page' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Tags updated' })
  async setTags(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetTagsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notesService.setTags(id, dto.tagIds, toNoteActor(user));
  }

  @Post(':id/restore')
  @RequirePermissions('notes:write')
  @ApiOperation({ summary: 'Restore a trashed note page (and its subtree)' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Note page restored' })
  @ApiResponse({ status: 404, description: 'Note page not found' })
  async restoreNote(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notesService.restoreNote(id, toNoteActor(user));
  }

  @Delete(':id')
  @RequirePermissions('notes:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Trash a note page (soft delete, cascades to descendants)' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 204, description: 'Note page trashed successfully' })
  @ApiResponse({ status: 404, description: 'Note page not found' })
  async trashNote(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.notesService.trashNote(id, toNoteActor(user));
  }

  @Delete(':id/purge')
  @RequirePermissions('notes:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Permanently delete a trashed note page' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 204, description: 'Note page permanently deleted' })
  @ApiResponse({ status: 404, description: 'Note page not found' })
  async purgeNote(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.notesService.purgeNote(id, toNoteActor(user));
  }

  // ------------------------------------------------------------------
  // Sharing
  //
  // Two different things live here, and the permission split reflects it: granting a
  // colleague access needs `editor` on the note, publishing it to the internet needs
  // `owner`. The first is reversible from the same dialog; the second is not, for
  // anyone who already copied the URL.
  // ------------------------------------------------------------------

  @Get(':id/access')
  @ApiOperation({ summary: 'Who can reach this note, and how — everything the share dialog shows' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Visibility, grants (direct and inherited) and links' })
  @ApiResponse({ status: 404, description: 'Note page not found, or not visible to you' })
  async getAccess(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sharingService.getAccessPanel(id, toNoteActor(user));
  }

  @Patch(':id/visibility')
  @RequirePermissions('notes:write')
  @ApiOperation({ summary: 'Switch a note between private and team-visible' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 200, description: 'Visibility updated' })
  async setVisibility(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetVisibilityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notesService.setVisibility(id, dto, toNoteActor(user));
  }

  @Post(':id/shares')
  @RequirePermissions('notes:write')
  @ApiOperation({ summary: 'Grant a user or role access to this note and its subtree' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 201, description: 'Access granted; returns the refreshed panel' })
  @ApiResponse({ status: 422, description: 'Sharing with yourself' })
  async addShare(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateNoteShareDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sharingService.addShare(id, dto, toNoteActor(user));
  }

  @Patch(':id/shares/:shareId')
  @RequirePermissions('notes:write')
  @ApiOperation({ summary: 'Change an existing grant’s level or expiry' })
  @ApiResponse({ status: 422, description: 'The grant is inherited — change it where it lives' })
  async updateShare(
    @Param('id', ParseIntPipe) id: number,
    @Param('shareId', ParseIntPipe) shareId: number,
    @Body() dto: UpdateNoteShareDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sharingService.updateShare(id, shareId, dto, toNoteActor(user));
  }

  @Delete(':id/shares/:shareId')
  @RequirePermissions('notes:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a grant' })
  @ApiResponse({ status: 204, description: 'Access revoked' })
  async removeShare(
    @Param('id', ParseIntPipe) id: number,
    @Param('shareId', ParseIntPipe) shareId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.sharingService.removeShare(id, shareId, toNoteActor(user));
  }

  @Post(':id/links')
  @RequirePermissions('notes:write')
  @ApiOperation({ summary: 'Publish the note to a public URL' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({
    status: 201,
    description:
      'The only response that ever carries the token in clear — only its SHA-256 is stored',
  })
  async createLink(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateNoteLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sharingService.createLink(id, dto, toNoteActor(user));
  }

  @Get(':id/links')
  @ApiOperation({ summary: 'Share links for this note (no tokens — they are not recoverable)' })
  @ApiParam({ name: 'id', type: Number })
  async listLinks(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sharingService.listLinks(id, toNoteActor(user));
  }

  @Patch(':id/links/:linkId')
  @RequirePermissions('notes:write')
  @ApiOperation({ summary: 'Change a link’s password, expiry, scope or indexing' })
  async updateLink(
    @Param('id', ParseIntPipe) id: number,
    @Param('linkId', ParseIntPipe) linkId: number,
    @Body() dto: UpdateNoteLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sharingService.updateLink(id, linkId, dto, toNoteActor(user));
  }

  @Post(':id/links/:linkId/rotate')
  @RequirePermissions('notes:write')
  @ApiOperation({
    summary: 'Issue a new URL and kill the old one, keeping the note published',
  })
  @ApiResponse({ status: 201, description: 'New link, with its token in clear once' })
  async rotateLink(
    @Param('id', ParseIntPipe) id: number,
    @Param('linkId', ParseIntPipe) linkId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sharingService.rotateLink(id, linkId, toNoteActor(user));
  }

  @Delete(':id/links/:linkId')
  @RequirePermissions('notes:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unpublish. Soft revoke — the audit trail survives it' })
  async revokeLink(
    @Param('id', ParseIntPipe) id: number,
    @Param('linkId', ParseIntPipe) linkId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.sharingService.revokeLink(id, linkId, toNoteActor(user));
  }

  @Get(':id/links/:linkId/views')
  @ApiOperation({ summary: 'Who has been reading a published note, and when' })
  @ApiResponse({
    status: 200,
    description: 'Totals, unique visitors by hashed IP, and a 30-day daily series',
  })
  async getLinkViews(
    @Param('id', ParseIntPipe) id: number,
    @Param('linkId', ParseIntPipe) linkId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sharingService.getLinkStats(id, linkId, toNoteActor(user));
  }
}
