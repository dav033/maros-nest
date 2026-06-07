import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpToolDeps } from './shared';
import { registerMcpTool } from './tool-registration';

export function registerTrelloTools(server: McpServer, deps: McpToolDeps) {
  registerMcpTool(
    server,
    'trello_list_boards',
    'List all open Trello boards the workspace token has access to. Use this to find the board where tasks should be created.',
    {
      filter: z
        .enum(['open', 'closed', 'all'])
        .optional()
        .default('open')
        .describe('Board filter. Default is open.'),
    },
    async ({ filter }: { filter?: 'open' | 'closed' | 'all' }) =>
      deps.trelloService.listBoardsForMe(filter),
  );

  registerMcpTool(
    server,
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
    async (input: Parameters<typeof deps.trelloService.createBoard>[0]) =>
      deps.trelloService.createBoard(input),
  );

  registerMcpTool(
    server,
    'trello_get_board',
    'Get a Trello board by id.',
    { boardId: z.string().describe('Trello board id') },
    async ({ boardId }: { boardId: string }) => deps.trelloService.getBoard(boardId),
  );

  registerMcpTool(
    server,
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
    async ({
      boardId,
      ...rest
    }: { boardId: string } & Parameters<typeof deps.trelloService.updateBoard>[1]) =>
      deps.trelloService.updateBoard(boardId, rest),
  );

  registerMcpTool(
    server,
    'trello_delete_board',
    'Permanently delete a Trello board by id. Use with extreme caution.',
    { boardId: z.string().describe('Trello board id') },
    async ({ boardId }: { boardId: string }) => {
      await deps.trelloService.deleteBoard(boardId);
      return { deleted: true, boardId };
    },
  );

  registerMcpTool(
    server,
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
    async ({
      boardId,
      filter,
    }: {
      boardId: string;
      filter?: 'open' | 'closed' | 'all';
    }) => deps.trelloService.listListsByBoard(boardId, filter),
  );

  registerMcpTool(
    server,
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
    async ({
      boardId,
      name,
      pos,
    }: {
      boardId: string;
      name: string;
      pos?: 'top' | 'bottom' | number;
    }) => deps.trelloService.createList({ idBoard: boardId, name, pos }),
  );

  registerMcpTool(
    server,
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
    async ({
      listId,
      ...rest
    }: { listId: string } & Parameters<typeof deps.trelloService.updateList>[1]) =>
      deps.trelloService.updateList(listId, rest),
  );

  registerMcpTool(
    server,
    'trello_archive_all_cards_in_list',
    'Archive all cards in a Trello list. Useful for cleanup or sprint rollover.',
    { listId: z.string().describe('Trello list id') },
    async ({ listId }: { listId: string }) => {
      await deps.trelloService.archiveAllCardsInList(listId);
      return { archivedAllCards: true, listId };
    },
  );

  registerMcpTool(
    server,
    'trello_list_members',
    'List members of a Trello board (id, fullName, username). Use this to map a person mentioned by the user (e.g. "Juan", "Ana") to a Trello idMember before creating/assigning cards.',
    { boardId: z.string().describe('Trello board id') },
    async ({ boardId }: { boardId: string }) =>
      deps.trelloService.listMembersByBoard(boardId),
  );

  registerMcpTool(
    server,
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
      attachments: z
        .array(
          z.object({
            url: z.string().url().describe('Attachment URL (publicly reachable)'),
            name: z.string().optional().describe('Attachment display name'),
            setCover: z
              .boolean()
              .optional()
              .describe('Set this attachment as card cover when possible'),
          }),
        )
        .optional()
        .describe('Optional attachments added immediately after card creation'),
    },
    async (input: Parameters<typeof deps.trelloService.createCard>[0]) =>
      deps.trelloService.createCard(input),
  );

  registerMcpTool(
    server,
    'trello_get_card',
    'Get a Trello card by id, including attachments.',
    { cardId: z.string() },
    async ({ cardId }: { cardId: string }) => deps.trelloService.getCard(cardId),
  );

  registerMcpTool(
    server,
    'trello_add_card_attachment',
    'Add a URL attachment to an existing Trello card.',
    {
      cardId: z.string().describe('Target Trello card id'),
      url: z.string().url().describe('Attachment URL (publicly reachable)'),
      name: z.string().optional().describe('Attachment display name'),
      setCover: z
        .boolean()
        .optional()
        .describe('Set this attachment as card cover when possible'),
    },
    async ({
      cardId,
      ...input
    }: { cardId: string } & Parameters<
      typeof deps.trelloService.addAttachmentToCard
    >[1]) => deps.trelloService.addAttachmentToCard(cardId, input),
  );

  registerMcpTool(
    server,
    'trello_list_card_attachments',
    'List all attachments in a Trello card.',
    { cardId: z.string().describe('Target Trello card id') },
    async ({ cardId }: { cardId: string }) =>
      deps.trelloService.listCardAttachments(cardId),
  );

  registerMcpTool(
    server,
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
    async ({
      cardId,
      ...rest
    }: { cardId: string } & Parameters<typeof deps.trelloService.updateCard>[1]) =>
      deps.trelloService.updateCard(cardId, rest),
  );

  registerMcpTool(
    server,
    'trello_delete_card',
    'Permanently delete a Trello card.',
    { cardId: z.string() },
    async ({ cardId }: { cardId: string }) => {
      await deps.trelloService.deleteCard(cardId);
      return { deleted: true, cardId };
    },
  );

  registerMcpTool(
    server,
    'trello_list_cards_by_list',
    'List all cards currently in a given Trello list.',
    { listId: z.string() },
    async ({ listId }: { listId: string }) =>
      deps.trelloService.listCardsByList(listId),
  );
}
