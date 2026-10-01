import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodRawShape } from 'zod';
import { McpToolDeps } from './shared';
import { registerUserTools } from './users';

type Registered = {
  description: string;
  schema: ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

const MCP_USER = { id: 42, email: 'mcp-agent@maros.invalid' };

function registerTools() {
  const tools = new Map<string, Registered>();
  const server = {
    tool: (
      name: string,
      description: string,
      schema: ZodRawShape,
      handler: (args: Record<string, unknown>) => Promise<unknown>,
    ) => {
      tools.set(name, { description, schema, handler });
    },
  };

  const usersService = {
    findAll: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue({ id: 1 }),
  };
  const rolesService = { findAll: jest.fn().mockResolvedValue([]) };
  const userInvitationsService = {
    invite: jest.fn().mockResolvedValue({ user: { id: 2 }, invitation: {} }),
    resend: jest.fn().mockResolvedValue({}),
    revoke: jest.fn().mockResolvedValue(undefined),
    checkAccess: jest.fn().mockResolvedValue({ allowed: false, reason: 'not_invited' }),
  };
  const mcpActor = { authenticatedUser: jest.fn().mockResolvedValue(MCP_USER) };

  registerUserTools(server as unknown as McpServer, {
    usersService,
    rolesService,
    userInvitationsService,
    mcpActor,
  } as unknown as McpToolDeps);

  return { tools, usersService, rolesService, userInvitationsService, mcpActor };
}

/** registerMcpTool envuelve el resultado en el sobre del MCP; esto lo abre. */
async function callJson(tool: Registered, args: Record<string, unknown>) {
  const result = (await tool.handler(args)) as { content: { text: string }[] };
  return JSON.parse(result.content[0].text);
}

function parse(schema: ZodRawShape, args: unknown) {
  return z.object(schema).safeParse(args);
}

describe('registerUserTools', () => {
  it('registers reading and invitations', () => {
    const { tools } = registerTools();

    expect([...tools.keys()].sort()).toEqual([
      'check_user_access',
      'get_user',
      'invite_user',
      'list_roles',
      'list_users',
      'resend_invitation',
      'revoke_invitation',
    ]);
  });

  // El MCP se autentica con un token compartido que no identifica a nadie. Una
  // tool de roles convertiria ese token en una llave de escalada de privilegios.
  it('exposes nothing that changes a role or switches an account on or off', () => {
    const { tools } = registerTools();
    const names = [...tools.keys()];

    for (const forbidden of [
      'update_user',
      'update_user_role',
      'set_user_role',
      'deactivate_user',
      'activate_user',
      'delete_user',
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('invites on behalf of the MCP system user, never a person', async () => {
    const { tools, userInvitationsService, mcpActor } = registerTools();
    const dto = {
      email: 'client@example.com',
      roleId: 3,
      userType: 'external' as const,
    };

    await tools.get('invite_user')!.handler(dto);

    expect(mcpActor.authenticatedUser).toHaveBeenCalled();
    expect(userInvitationsService.invite).toHaveBeenCalledWith(dto, MCP_USER);
  });

  it('passes the actor when resending too', async () => {
    const { tools, userInvitationsService } = registerTools();

    await tools.get('resend_invitation')!.handler({ userId: 8 });

    expect(userInvitationsService.resend).toHaveBeenCalledWith(8, MCP_USER);
  });

  it('reports the revocation as done instead of returning nothing', async () => {
    const { tools } = registerTools();

    await expect(
      callJson(tools.get('revoke_invitation')!, { userId: 8 }),
    ).resolves.toEqual({ userId: 8, revoked: true });
  });

  it.each([
    ['an address that is not an email', { email: 'not-an-email', roleId: 1, userType: 'internal' }],
    ['a user type that does not exist', { email: 'a@b.com', roleId: 1, userType: 'guest' }],
    ['a missing role', { email: 'a@b.com', userType: 'internal' }],
    ['an expiry over 90 days', { email: 'a@b.com', roleId: 1, userType: 'internal', expiresInDays: 365 }],
  ])('refuses to invite with %s', (_label, args) => {
    const { tools } = registerTools();

    expect(parse(tools.get('invite_user')!.schema, args).success).toBe(false);
  });

  it('reads users, roles and access without an actor', async () => {
    const { tools, usersService, rolesService, userInvitationsService } = registerTools();

    await tools.get('list_users')!.handler({});
    await tools.get('get_user')!.handler({ id: 4 });
    await tools.get('list_roles')!.handler({});
    await tools.get('check_user_access')!.handler({ email: 'who@example.com' });

    expect(usersService.findAll).toHaveBeenCalled();
    expect(usersService.findById).toHaveBeenCalledWith(4);
    expect(rolesService.findAll).toHaveBeenCalled();
    expect(userInvitationsService.checkAccess).toHaveBeenCalledWith('who@example.com');
  });
});
