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

/** Compartido porque usersService.update se asigna dentro de registerTools. */
let usersUpdateMock: jest.Mock;

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
  const usersServiceUpdate = jest.fn().mockResolvedValue({ id: 1 });
  (usersService as Record<string, unknown>).update = usersServiceUpdate;
  usersUpdateMock = usersServiceUpdate;
  const rolesService = {
    findAll: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 5 }),
    update: jest.fn().mockResolvedValue({ id: 5 }),
    delete: jest.fn().mockResolvedValue(undefined),
  };
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
      'create_role',
      'delete_role',
      'get_user',
      'invite_user',
      'list_permissions',
      'list_roles',
      'list_users',
      'resend_invitation',
      'revoke_invitation',
      'update_role',
      'update_user',
    ]);
  });

  // Alcance completo por decision explicita del dueno: el MCP lo usa una sola
  // persona y su token lleva todo el poder. Eso convierte MCP_TOKEN en una
  // credencial de nivel admin, y estos tests fijan que al menos quede firmado
  // por el usuario de sistema y no por nadie del equipo.
  describe('role and account management', () => {
    it('changes a role as the MCP system user, never as a person', async () => {
      const { tools, mcpActor } = registerTools();

      await tools.get('update_user')!.handler({ id: 3, roleId: 1 });

      expect(mcpActor.authenticatedUser).toHaveBeenCalled();
      expect(usersUpdateMock).toHaveBeenCalledWith(3, { roleId: 1 }, MCP_USER.id);
    });

    it('switches an account off without touching its role', async () => {
      const { tools } = registerTools();

      await tools.get('update_user')!.handler({ id: 3, isActive: false });

      expect(usersUpdateMock).toHaveBeenCalledWith(3, { isActive: false }, MCP_USER.id);
    });

    it('creates and edits roles', async () => {
      const { tools, rolesService } = registerTools();

      await tools
        .get('create_role')!
        .handler({ name: 'Bookkeeper', permissions: ['finance:read'] });
      await tools.get('update_role')!.handler({ id: 5, permissions: [] });

      expect(rolesService.create).toHaveBeenCalledWith({
        name: 'Bookkeeper',
        permissions: ['finance:read'],
      });
      expect(rolesService.update).toHaveBeenCalledWith(5, { permissions: [] });
    });

    it('refuses a permission that is not in the catalogue', () => {
      const { tools } = registerTools();

      expect(
        parse(tools.get('create_role')!.schema, {
          name: 'Invented',
          permissions: ['everything:always'],
        }).success,
      ).toBe(false);
    });

    it.each([
      ['confirm is false', { id: 5, confirm: false }],
      ['confirm is missing', { id: 5 }],
    ])('refuses to delete a role when %s', (_label, args) => {
      const { tools } = registerTools();

      expect(parse(tools.get('delete_role')!.schema, args).success).toBe(false);
    });

    it('deletes a role when the call confirms it', async () => {
      const { tools, rolesService } = registerTools();

      await expect(
        callJson(tools.get('delete_role')!, { id: 5, confirm: true }),
      ).resolves.toEqual({ id: 5, deleted: true });
      expect(rolesService.delete).toHaveBeenCalledWith(5);
    });

    it('serves the permission catalogue so a role can be built from it', async () => {
      const { tools } = registerTools();

      const result = await callJson(tools.get('list_permissions')!, {});

      expect(Array.isArray(result.permissions)).toBe(true);
      expect(result.permissions.length).toBeGreaterThan(0);
    });
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
