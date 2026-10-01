import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { UsersRepository } from '../users/user-management/repositories/users.repository';
import { UsersService } from '../users/user-management/users.service';
import { McpActorService, MCP_ACTOR_EMAIL } from './mcp-actor.service';

function harness(opts: {
  systemUser?: { id: number; email: string } | null;
  target?: { id: number; email: string; isActive: boolean };
} = {}) {
  const usersRepo = {
    findByEmail: jest
      .fn()
      .mockResolvedValue(
        opts.systemUser === undefined
          ? { id: 17, email: MCP_ACTOR_EMAIL }
          : opts.systemUser,
      ),
  };
  const users = {
    findById: jest.fn().mockResolvedValue(
      opts.target ?? { id: 4, email: 'alice@marosconstruction.com', isActive: true },
    ),
    toAuthenticatedUser: jest
      .fn()
      .mockImplementation((u: { id: number; email: string }) => ({
        id: u.id,
        email: u.email,
        permissions: [],
      })),
  };

  const service = new McpActorService(
    usersRepo as unknown as UsersRepository,
    users as unknown as UsersService,
  );
  return { service, usersRepo, users };
}

describe('McpActorService', () => {
  describe('authenticatedUser', () => {
    it('resolves the system user by its reserved address', async () => {
      const { service, usersRepo } = harness();

      await expect(service.authenticatedUser()).resolves.toMatchObject({ id: 17 });
      expect(usersRepo.findByEmail).toHaveBeenCalledWith(MCP_ACTOR_EMAIL);
    });

    // El SQL es manual (synchronize: false). Un mensaje que nombra el archivo se
    // diagnostica mucho mas rapido que un error de clave ajena mas abajo.
    it('names the SQL file to run when the row is missing', async () => {
      const { service } = harness({ systemUser: null });

      await expect(service.authenticatedUser()).rejects.toThrow(
        InternalServerErrorException,
      );
      await expect(service.authenticatedUser()).rejects.toThrow(
        'db/add-mcp-system-user.sql',
      );
    });

    it('resolves it once per process and reuses it', async () => {
      const { service, usersRepo } = harness();

      await service.authenticatedUser();
      await service.authenticatedUser();
      await service.taskActor();

      expect(usersRepo.findByEmail).toHaveBeenCalledTimes(1);
    });
  });

  // Gobierna editar o borrar el comentario de otra persona: el agente escribe los
  // suyos, los ajenos no son suyos para tocar.
  it('never grants itself the right to touch other people comments', async () => {
    const { service } = harness();

    await expect(service.taskActor()).resolves.toEqual({ id: 17, canDelete: false });
  });

  describe('userAs, the only place the MCP acts as somebody else', () => {
    it('returns that person, resolved through UsersService', async () => {
      const { service, users } = harness();

      await expect(service.userAs(4)).resolves.toMatchObject({
        id: 4,
        email: 'alice@marosconstruction.com',
      });
      expect(users.findById).toHaveBeenCalledWith(4);
    });

    // Si alguien ya no tiene acceso, el agente tampoco debe actuar en su nombre.
    it('refuses to impersonate a deactivated account, and says whose', async () => {
      const { service } = harness({
        target: { id: 9, email: 'former@marosconstruction.com', isActive: false },
      });

      await expect(service.userAs(9)).rejects.toThrow(BadRequestException);
      await expect(service.userAs(9)).rejects.toThrow('former@marosconstruction.com');
    });

    it('does not cache, so deactivating somebody bites on the next call', async () => {
      const { service, users } = harness();

      await service.userAs(4);
      await service.userAs(4);

      expect(users.findById).toHaveBeenCalledTimes(2);
    });
  });
});
