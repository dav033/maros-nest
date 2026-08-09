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

@ApiTags('notes')
@Controller('notes')
// Class-level default; write/delete routes override it below.
@RequirePermissions('notes:read')
export class NotesController {
  constructor(
    private readonly notesService: NotesService,
    private readonly noteTagsService: NoteTagsService,
  ) {}

  // --- Static routes first: they must never be shadowed by ':id'. ---

  @Get()
  @ApiOperation({ summary: 'Get all note pages (flat list, no content)' })
  @ApiResponse({ status: 200, description: 'Returns all active note pages' })
  async getAllNotes(@CurrentUser() user: AuthenticatedUser) {
    return this.notesService.getAllNotes(user.id);
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
    return this.notesService.getNotesByEntity(entityKind, entityId, user.id);
  }

  @Get('trash')
  @ApiOperation({ summary: 'Get trashed note pages (top-level of each trashed subtree)' })
  @ApiResponse({ status: 200, description: 'Returns trashed note pages' })
  async getTrash(@CurrentUser() user: AuthenticatedUser) {
    return this.notesService.getTrash(user.id);
  }

  @Get('favorites')
  @ApiOperation({ summary: 'Get favorite note pages' })
  @ApiResponse({ status: 200, description: 'Returns favorite note pages' })
  async getFavorites(@CurrentUser() user: AuthenticatedUser) {
    return this.notesService.getFavorites(user.id);
  }

  @Get('search')
  @ApiOperation({ summary: 'Full-text search over note titles and content' })
  @ApiResponse({ status: 200, description: 'Returns matching note pages, ranked' })
  async searchNotes(
    @Query() query: SearchNotesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notesService.searchNotes(query.q, query.limit ?? 20, user.id);
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
    return this.notesService.createNote(dto, user.id);
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
    return this.notesService.getNoteById(id, user.id);
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
    return this.notesService.updateNote(id, dto, user.id);
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
    return this.notesService.updateNoteContent(id, dto, user.id);
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
    return this.notesService.moveNote(id, dto, user.id);
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
    return this.notesService.setFavorite(id, dto.isFavorite, user.id);
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
    return this.notesService.setEntityLink(id, dto, user.id);
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
    return this.notesService.setTags(id, dto.tagIds, user.id);
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
    return this.notesService.restoreNote(id, user.id);
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
    await this.notesService.trashNote(id, user.id);
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
    await this.notesService.purgeNote(id, user.id);
  }
}
