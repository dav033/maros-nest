import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodRawShape } from 'zod';
import { McpToolDeps } from './shared';
import { registerGoogleCalendarTools } from './google-calendar';

type Registered = {
  description: string;
  schema: ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

const ALICE = { id: 4, email: 'alice@marosconstruction.com' };

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

  const googleCalendarService = {
    getConnection: jest.fn().mockResolvedValue({ connected: true }),
    listMeetings: jest.fn().mockResolvedValue([]),
    createMeeting: jest.fn().mockResolvedValue({ id: 1, meetUrl: 'https://meet/x' }),
    updateMeeting: jest.fn().mockResolvedValue({ id: 1 }),
    cancelMeeting: jest.fn().mockResolvedValue(undefined),
  };
  const mcpActor = {
    userAs: jest.fn().mockResolvedValue(ALICE),
    authenticatedUser: jest.fn().mockResolvedValue({ id: 17 }),
  };

  registerGoogleCalendarTools(server as unknown as McpServer, {
    googleCalendarService,
    mcpActor,
  } as unknown as McpToolDeps);

  return { tools, googleCalendarService, mcpActor };
}

function parse(schema: ZodRawShape, args: unknown) {
  return z.object(schema).safeParse(args);
}

async function callJson(tool: Registered, args: Record<string, unknown>) {
  const result = (await tool.handler(args)) as { content: { text: string }[] };
  return JSON.parse(result.content[0].text);
}

const MEETING = {
  userId: 4,
  title: 'Walkthrough with the Smiths',
  startsAt: '2026-11-02T15:00:00-05:00',
  endsAt: '2026-11-02T16:00:00-05:00',
  timeZone: 'America/New_York',
};

describe('registerGoogleCalendarTools', () => {
  it('registers the five calendar tools and no OAuth redirect', () => {
    const { tools } = registerTools();
    const names = [...tools.keys()].sort();

    expect(names).toEqual([
      'cancel_google_calendar_meeting',
      'create_google_calendar_meeting',
      'get_google_calendar_connection',
      'list_google_calendar_meetings',
      'update_google_calendar_meeting',
    ]);
    // /connect y /callback son redirecciones de navegador, no sirven como tool.
    expect(names.some((n) => n.includes('connect') && n !== 'get_google_calendar_connection')).toBe(
      false,
    );
  });

  // Es el unico grupo que actua como una persona. Si una tool olvidara el userId
  // y firmara con el usuario de sistema, fallaria siempre: ese usuario no puede
  // tener conexion con Google porque no puede iniciar sesion.
  describe('acts as a named person, never as the system user', () => {
    it.each([
      ['list_google_calendar_meetings', { userId: 4 }],
      ['create_google_calendar_meeting', MEETING],
      ['update_google_calendar_meeting', { userId: 4, id: 1, title: 'Moved' }],
      ['cancel_google_calendar_meeting', { userId: 4, id: 1, confirm: true }],
    ])('resolves the actor through userAs for %s', async (tool, args) => {
      const { tools, mcpActor } = registerTools();

      await tools.get(tool)!.handler(args);

      expect(mcpActor.userAs).toHaveBeenCalledWith(4);
      expect(mcpActor.authenticatedUser).not.toHaveBeenCalled();
    });

    it('requires a userId on every tool', () => {
      const { tools } = registerTools();

      for (const [, tool] of tools) {
        expect(parse(tool.schema, {}).success).toBe(false);
      }
    });

    it('passes that person, not the id, to the service', async () => {
      const { tools, googleCalendarService } = registerTools();

      await tools.get('create_google_calendar_meeting')!.handler(MEETING);

      const [user, dto] = googleCalendarService.createMeeting.mock.calls[0];
      expect(user).toBe(ALICE);
      expect(dto).not.toHaveProperty('userId');
      expect(dto).toMatchObject({ title: MEETING.title, timeZone: MEETING.timeZone });
    });
  });

  it('checks the connection without impersonating anyone', async () => {
    const { tools, googleCalendarService, mcpActor } = registerTools();

    await tools.get('get_google_calendar_connection')!.handler({ userId: 4 });

    expect(googleCalendarService.getConnection).toHaveBeenCalledWith(4);
    expect(mcpActor.userAs).not.toHaveBeenCalled();
  });

  describe('cancelling tells the truth about what it did', () => {
    it.each([
      ['no confirm', { userId: 4, id: 1 }],
      ['confirm false', { userId: 4, id: 1, confirm: false }],
    ])('refuses with %s', (_label, args) => {
      const { tools } = registerTools();

      expect(parse(tools.get('cancel_google_calendar_meeting')!.schema, args).success).toBe(
        false,
      );
    });

    it('reports that the attendees were notified', async () => {
      const { tools, googleCalendarService } = registerTools();

      await expect(
        callJson(tools.get('cancel_google_calendar_meeting')!, {
          userId: 4,
          id: 1,
          confirm: true,
        }),
      ).resolves.toEqual({ id: 1, cancelled: true, attendeesNotified: true });
      expect(googleCalendarService.cancelMeeting).toHaveBeenCalledWith(ALICE, 1);
    });
  });

  describe('validation', () => {
    it.each([
      ['a start without a time zone offset', { ...MEETING, startsAt: '2026-11-02T15:00:00' }],
      ['a plain date instead of a timestamp', { ...MEETING, startsAt: '2026-11-02' }],
      ['an empty title', { ...MEETING, title: '   ' }],
      ['an attendee that is not an email', { ...MEETING, attendees: ['not-an-email'] }],
      ['an entity id of zero', { ...MEETING, entityKind: 'lead', entityId: 0 }],
      ['an entity kind that does not exist', { ...MEETING, entityKind: 'project', entityId: 1 }],
    ])('rejects %s', (_label, args) => {
      const { tools } = registerTools();

      expect(parse(tools.get('create_google_calendar_meeting')!.schema, args).success).toBe(
        false,
      );
    });

    it('accepts both Z and an explicit offset', () => {
      const { tools } = registerTools();

      for (const startsAt of ['2026-11-02T20:00:00Z', '2026-11-02T15:00:00-05:00']) {
        expect(
          parse(tools.get('create_google_calendar_meeting')!.schema, { ...MEETING, startsAt })
            .success,
        ).toBe(true);
      }
    });
  });

  it('warns in its own text that these calls reach people outside the system', () => {
    const { tools } = registerTools();

    expect(tools.get('create_google_calendar_meeting')!.description).toContain('invitación');
    expect(tools.get('cancel_google_calendar_meeting')!.description).toContain('invitados');
    expect(tools.get('update_google_calendar_meeting')!.description).toContain('correo');
  });
});
