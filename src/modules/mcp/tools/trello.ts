import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { McpToolDeps, jsonContent } from './shared';

export function registerTrelloTools(server: McpServer, deps: McpToolDeps) {
  server.tool(
    'trello_list_boards',
    'List all open Trello boards the workspace token has access to. Use this to find the board where tasks should be created.',
    {},
    async () => jsonContent(await deps.trelloService.listBoardsForMe()),
  );

  server.tool(
    'trello_list_lists',
    'List all open lists (columns) in a Trello board. Use this to find the idList for creating a card (e.g. "To Do", "In Progress").',
    { boardId: z.string().describe('Trello board id') },
    async ({ boardId }) =>
      jsonContent(await deps.trelloService.listListsByBoard(boardId)),
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
