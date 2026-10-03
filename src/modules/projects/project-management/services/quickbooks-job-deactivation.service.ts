import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../../../../entities/project.entity';
import { QboConnection } from '../../../quickbooks/entities/qbo-connection.entity';
import { QuickbooksApiService } from '../../../quickbooks/services/core/quickbooks-api.service';
import { QuickbooksFinancialsService } from '../../../quickbooks/services/financials/quickbooks-financials.service';
import { DeactivateQuickbooksJobDto } from '../dto/deactivate-quickbooks-job.dto';

/** Por debajo de un centavo no hay saldo que cancelar, solo redondeo. */
const BALANCE_EPSILON = 0.01;

export type DeactivateQuickbooksJobResult = {
  qboCustomerId: string;
  displayName: string;
  /** Estado en que queda el Customer en QuickBooks. */
  active: boolean;
  deactivated: boolean;
  /** QuickBooks ya lo tenia inactivo: no se escribio nada. */
  alreadyInactive: boolean;
};

type QboCustomer = {
  Id?: string | number;
  SyncToken?: string | number;
  DisplayName?: string;
  Active?: boolean;
  Balance?: number | string;
  Job?: boolean;
};

/**
 * Desactiva un job de QuickBooks desde la pantalla de importacion.
 *
 * Vive aparte de `QuickbooksProjectImportService` porque es la unica escritura
 * del modulo de proyectos que cae en la contabilidad y no en el CRM: enterrada
 * entre las seiscientas lineas del import, sus tres guardas dejarian de verse.
 *
 * No hay operacion de borrado para un Customer en la API de QuickBooks — las
 * entidades de lista de nombres solo se pueden desactivar, que es el "Make
 * inactive" de la interfaz de Intuit —, asi que esto es lo mas parecido a
 * "eliminar un job" que existe. Las transacciones del job y su historico se
 * conservan.
 */
@Injectable()
export class QuickbooksJobDeactivationService {
  private readonly logger = new Logger(QuickbooksJobDeactivationService.name);

  constructor(
    @InjectRepository(QboConnection)
    private readonly connectionRepo: Repository<QboConnection>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    private readonly api: QuickbooksApiService,
    private readonly financials: QuickbooksFinancialsService,
  ) {}

  async deactivateJob(
    dto: DeactivateQuickbooksJobDto,
    actorEmail?: string | null,
  ): Promise<DeactivateQuickbooksJobResult> {
    // El ValidationPipe ya lo exige en la ruta HTTP, pero la guarda vive aqui
    // porque el servicio es tambien lo que llamaria una herramienta de MCP o
    // cualquier camino interno, donde no hay pipe delante.
    if (dto?.confirm !== true) {
      throw new BadRequestException(
        'Deactivating a QuickBooks job requires confirm: true.',
      );
    }
    const qboCustomerId = String(dto?.qboCustomerId ?? '').trim();
    if (!qboCustomerId) {
      throw new BadRequestException('A QuickBooks job is required.');
    }

    const realmId = await this.resolveRealmId();
    const customer = await this.fetchCustomer(realmId, qboCustomerId);
    const displayName = String(customer.DisplayName ?? '');

    // Un job que ya esta inactivo no se puede volver a desactivar, y rechazarlo
    // por saldo o por vinculo haria creer que falta algo por hacer cuando la
    // llamada no cambiaria nada.
    if (customer.Active === false) {
      return {
        qboCustomerId,
        displayName,
        active: false,
        deactivated: false,
        alreadyInactive: true,
      };
    }

    this.assertNoOpenBalance(customer, qboCustomerId, displayName);
    await this.assertNotLinkedToCrmProject(qboCustomerId, displayName);

    const syncToken = String(customer.SyncToken ?? '');
    if (!syncToken) {
      throw new ConflictException(
        `QuickBooks did not return a SyncToken for job ${qboCustomerId}. Refresh the list and try again.`,
      );
    }

    let response: unknown;
    try {
      response = await this.api.mutateEntity(realmId, 'Customer', {
        Id: String(customer.Id ?? qboCustomerId),
        SyncToken: syncToken,
        // Una actualizacion parcial: sin `sparse` QuickBooks interpreta el
        // cuerpo como el Customer completo y borra todo lo que no viaje en el.
        sparse: true,
        Active: false,
      });
    } catch (error) {
      // El motivo real lo da Intuit; un mensaje nuestro solo lo taparia, y aqui
      // la diferencia entre "saldo abierto" y "token caducado" es lo unico que
      // le dice al operador que hacer a continuacion.
      throw new BadRequestException(
        `QuickBooks rejected deactivating job ${qboCustomerId}: ${extractQboFaultMessage(error)}`,
      );
    }

    const saved = this.api.unwrapQboEntity(response, 'Customer') as QboCustomer;

    // El indice de jobs y las lecturas en cache siguen contando este job como
    // activo hasta que se purgan; la pantalla recarga justo despues.
    this.financials.invalidateJobIndex();
    this.api.clearReadCache();

    const by = actorEmail ? ` by ${actorEmail}` : '';
    this.logger.log(
      `QuickBooks job ${qboCustomerId} "${displayName}" deactivated (Active=false)${by}`,
    );

    return {
      qboCustomerId,
      displayName: String(saved.DisplayName ?? displayName),
      active: saved.Active === true,
      deactivated: true,
      alreadyInactive: false,
    };
  }

  /**
   * Guarda 1. Desactivar un cliente con saldo abierto no es neutro: o la API lo
   * rechaza, o QuickBooks cancela ese saldo contra una cuenta de ajuste y el
   * importe desaparece del envejecimiento sin que nadie lo haya cobrado. El
   * importe va en el mensaje porque es lo que hay que ir a resolver.
   *
   * Tambien bloquea un saldo a favor del cliente (negativo): un anticipo sin
   * aplicar es actividad abierta igual que una factura sin cobrar.
   */
  private assertNoOpenBalance(
    customer: QboCustomer,
    qboCustomerId: string,
    displayName: string,
  ): void {
    const balance = Number(customer.Balance) || 0;
    if (Math.abs(balance) < BALANCE_EPSILON) return;
    throw new ConflictException(
      `QuickBooks job ${qboCustomerId} "${displayName}" has an open balance of ${balance.toFixed(2)}. Deactivating it would write that balance off in QuickBooks, so settle or void it there first.`,
    );
  }

  /**
   * Guarda 2. Un proyecto del CRM que apunta a un job desactivado queda
   * apuntando a un id que ya no sale en ninguna lista de QuickBooks: es el lio
   * que ya tenemos con dos proyectos resolviendo al mismo job. Desvincular
   * primero (DELETE /projects/:id/qbo-link) conserva el proyecto y su lead.
   */
  private async assertNotLinkedToCrmProject(
    qboCustomerId: string,
    displayName: string,
  ): Promise<void> {
    const linked = await this.projectRepo.findOne({
      where: { qboCustomerId },
      relations: ['lead'],
    });
    if (!linked) return;
    const number = linked.lead?.leadNumber ? ` (${linked.lead.leadNumber})` : '';
    throw new ConflictException(
      `QuickBooks job ${qboCustomerId} "${displayName}" is linked to CRM project #${linked.id}${number}. Unlink it first — unlinking keeps the project and its lead.`,
    );
  }

  private async resolveRealmId(): Promise<string> {
    const [connection] = await this.connectionRepo.find({ take: 1 });
    if (!connection) {
      throw new ServiceUnavailableException('QuickBooks is not connected.');
    }
    return connection.realmId;
  }

  /**
   * QuickBooks exige `Id` y `SyncToken` para actualizar, asi que hay que leer el
   * Customer antes. Se purga la cache de lecturas primero porque esa cache vive
   * cinco minutos: con un `SyncToken` viejo QuickBooks rechaza la escritura, y
   * con un `Balance` viejo la guarda del saldo deja pasar una factura emitida
   * hace dos minutos, que es justo lo que viene a impedir.
   */
  private async fetchCustomer(
    realmId: string,
    qboCustomerId: string,
  ): Promise<QboCustomer> {
    this.api.clearReadCache();
    let response: unknown;
    try {
      response = await this.api.getCustomer(realmId, qboCustomerId);
    } catch (error) {
      throw new NotFoundException(
        `QuickBooks job ${qboCustomerId} could not be read: ${extractQboFaultMessage(error)}`,
      );
    }
    const customer = this.api.unwrapQboEntity(response, 'Customer') as QboCustomer;
    if (customer.Id == null) {
      throw new NotFoundException(
        `QuickBooks job ${qboCustomerId} could not be found. Refresh the list and try again.`,
      );
    }
    return customer;
  }
}

/** El mensaje que Intuit puso en el Fault de una escritura rechazada. */
function extractQboFaultMessage(error: unknown): string {
  const response = (error as { response?: { data?: unknown } })?.response;
  const fault = (
    response?.data as
      | { Fault?: { Error?: Array<{ Message?: string; Detail?: string }> } }
      | undefined
  )?.Fault;
  const messages = (fault?.Error ?? [])
    .map((entry) => [entry.Message, entry.Detail].filter(Boolean).join(' — '))
    .filter((message) => message.length > 0);
  if (messages.length > 0) return messages.join('; ');
  const message = (error as { message?: string })?.message;
  return message && message.length > 0 ? message : 'the write was rejected.';
}
