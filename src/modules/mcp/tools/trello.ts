import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpToolDeps, jsonContent } from './shared';

export function registerTrelloTools(server: McpServer, deps: McpToolDeps) {
  server.tool(
    'trello_list_boards',
    'List all open Trello boards the workspace token has access to. Use this to find the board where tasks should be created.',
    {
      filter: z
        .enum(['open', 'closed', 'all'])
        .optional()
        .default('open')
        .describe('Board filter. Default is open.'),
    },
    async ({ filter }) =>
      jsonContent(await deps.trelloService.listBoardsForMe(filter)),
  );

  server.tool(
    'trello_create_board',
    'Create a new Trello board. Use this when the user asks for a new workspace board to organize tasks.',
    {
      name: z.string().describe('Board name'),
      desc: z.string().optional().describe('Board description'),
      defaultLists: z
        .boolean()
        .optional()
        .describe('Create default lists (To Do, Doing, Done). Defaults to true.'),
      defaultLabels: z
        .boolean()
        .optional()
        .describe('Create default labels. Defaults to true.'),
      idOrganization: z
        .string()
        .optional()
        .describe('Optional Trello workspace organization id'),
      prefsPermissionLevel: z
        .enum(['private', 'org', 'public'])
        .optional()
        .describe('Board visibility: private, org, or public'),
    },
    async (input) => jsonContent(await deps.trelloService.createBoard(input)),
  );

  server.tool(
    'trello_get_board',
    'Get a Trello board by id.',
    { boardId: z.string().describe('Trello board id') },
    async ({ boardId }) =>
      jsonContent(await deps.trelloService.getBoard(boardId)),
  );

  server.tool(
    'trello_update_board',
    'Update a Trello board (rename, description, close/open, visibility).',
    {
      boardId: z.string().describe('Trello board id'),
      name: z.string().optional().describe('New board name'),
      desc: z.string().optional().describe('New board description'),
      closed: z.boolean().optional().describe('Close board (true) or reopen (false)'),
      subscribed: z
        .boolean()
        .optional()
        .describe('Subscribe current token user to board updates'),
      prefsPermissionLevel: z
        .enum(['private', 'org', 'public'])
        .optional()
        .describe('Board visibility: private, org, or public'),
    },
    async ({ boardId, ...rest }) =>
      jsonContent(await deps.trelloService.updateBoard(boardId, rest)),
  );

  server.tool(
    'trello_delete_board',
    'Permanently delete a Trello board by id. Use with extreme caution.',
    { boardId: z.string().describe('Trello board id') },
    async ({ boardId }) => {
      await deps.trelloService.deleteBoard(boardId);
      return jsonContent({ deleted: true, boardId });
    },
  );

  server.tool(
    'trello_list_lists',
    'List all open lists (columns) in a Trello board. Use this to find the idList for creating a card (e.g. "To Do", "In Progress").',
    {
      boardId: z.string().describe('Trello board id'),
      filter: z
        .enum(['open', 'closed', 'all'])
        .optional()
        .default('open')
        .describe('List filter. Default is open.'),
    },
    async ({ boardId, filter }) =>
      jsonContent(await deps.trelloService.listListsByBoard(boardId, filter)),
  );

  server.tool(
    'trello_create_list',
    'Create a new list (column) in a Trello board.',
    {
      boardId: z.string().describe('Target Trello board id'),
      name: z.string().describe('List name'),
      pos: z
        .union([z.enum(['top', 'bottom']), z.number().int().nonnegative()])
        .optional()
        .describe('Position in board: top, bottom, or numeric position'),
    },
    async ({ boardId, name, pos }) =>
      jsonContent(await deps.trelloService.createList({ idBoard: boardId, name, pos })),
  );

  server.tool(
    'trello_update_list',
    'Update a Trello list (rename, archive/unarchive, reorder).',
    {
      listId: z.string().describe('Trello list id'),
      name: z.string().optional().describe('New list name'),
      closed: z
        .boolean()
        .optional()
        .describe('Archive list (true) or unarchive (false)'),
      pos: z
        .union([z.enum(['top', 'bottom']), z.number().int().nonnegative()])
        .optional()
        .describe('Position in board: top, bottom, or numeric position'),
    },
    async ({ listId, ...rest }) =>
      jsonContent(await deps.trelloService.updateList(listId, rest)),
  );

  server.tool(
    'trello_archive_all_cards_in_list',
    'Archive all cards in a Trello list. Useful for cleanup or sprint rollover.',
    { listId: z.string().describe('Trello list id') },
    async ({ listId }) => {
      await deps.trelloService.archiveAllCardsInList(listId);
      return jsonContent({ archivedAllCards: true, listId });
    },
  );

  server.tool(
    'trello_list_members',
    'List members of a Trello board (id, fullName, username). Use this to map a person mentioned by the user (e.g. "Juan", "Ana") to a Trello idMember before creating/assigning cards.',
    { boardId: z.string().describe('Trello board id') },
    async ({ boardId }) =>
      jsonContent(await deps.trelloService.listMembersByBoard(boardId)),
  );

  server.tool(
    'trello_create_card',
    'Create a Trello card (task) in a list. Resolve idList via trello_list_lists and idMembers via trello_list_members BEFORE calling this.',
    {
      idList: z.string().describe('Target Trello list id'),
      name: z.string().describe('Card title'),
      desc: z
        .string()
        .optional()
        .describe('Card description / body (markdown supported)'),
      due: z
        .string()
        .optional()
        .describe('Due date in ISO 8601 (YYYY-MM-DDTHH:mm:ssZ)'),
      idMembers: z
        .array(z.string())
        .optional()
        .describe(
          'Trello member ids to assign. Resolve names -> ids via trello_list_members.',
        ),
      pos: z.enum(['top', 'bottom']).optional().describe('Position in list'),
    },
    async (input) => jsonContent(await deps.trelloService.createCard(input)),
  );

  server.tool(
    'trello_get_card',
    'Get a Trello card by id.',
    { cardId: z.string() },
    async ({ cardId }) => jsonContent(await deps.trelloService.getCard(cardId)),
  );

  server.tool(
    'trello_update_card',
    'Update an existing Trello card (rename, change due date, reassign members, move list, archive).',
    {
      cardId: z.string(),
      name: z.string().optional(),
      desc: z.string().optional(),
      due: z.string().nullable().optional().describe('ISO date or null to clear'),
      idList: z.string().optional().describe('Move card to this list'),
      closed: z.boolean().optional().describe('Archive (true) or unarchive (false)'),
      idMembers: z.array(z.string()).optional().describe('Replace assigned members'),
    },
    async ({ cardId, ...rest }) =>
      jsonContent(await deps.trelloService.updateCard(cardId, rest)),
  );

  server.tool(
    'trello_delete_card',
    'Permanently delete a Trello card.',
    { cardId: z.string() },
    async ({ cardId }) => {
      await deps.trelloService.deleteCard(cardId);
      return jsonContent({ deleted: true, cardId });
    },
  );

  server.tool(
    'trello_list_cards_by_list',
    'List all cards currently in a given Trello list.',
    { listId: z.string() },
    async ({ listId }) =>
      jsonContent(await deps.trelloService.listCardsByList(listId)),
  );
}
