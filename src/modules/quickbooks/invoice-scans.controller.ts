import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AttachInvoiceScanFileDto } from './dto/attach-invoice-scan-file.dto';
import { CompleteInvoiceScanAttachmentDto } from './dto/complete-invoice-scan-attachment.dto';
import { CreateManualInvoiceTransactionDto } from './dto/create-manual-invoice-transaction.dto';
import { CreateInvoiceScanDto } from './dto/create-invoice-scan.dto';
import { CreateQboCounterpartyDto } from './dto/create-qbo-counterparty.dto';
import { UpdateInvoiceScanDto } from './dto/update-invoice-scan.dto';
import { InvoiceCounterpartyWriteService } from './services/invoice-scans/invoice-counterparty-write.service';
import { InvoiceScansService } from './services/invoice-scans.service';

@ApiTags('Invoice scans')
@Controller('invoice-scans')
@RequirePermissions('finance:write')
export class InvoiceScansController {
  constructor(
    private readonly invoiceScans: InvoiceScansService,
    private readonly counterpartyWrite: InvoiceCounterpartyWriteService,
  ) {}

  @Get()
  list() {
    return this.invoiceScans.list();
  }

  /** Declared before `:id` so the literal segment wins the route match. */
  @Get('counterparties')
  counterparties() {
    return this.invoiceScans.listQboCounterparties();
  }

  @Post('counterparties')
  createCounterparty(@Body() body: CreateQboCounterpartyDto) {
    return this.counterpartyWrite.create(body);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoiceScans.get(id);
  }

  @Post()
  create(@Body() body: CreateInvoiceScanDto) {
    return this.invoiceScans.create(body);
  }

  @Post('manual')
  createManual(
    @Body() body: CreateManualInvoiceTransactionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoiceScans.createManualTransaction(body, user);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateInvoiceScanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoiceScans.update(id, body, user);
  }

  @Post(':id/scan')
  scan(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoiceScans.scan(id);
  }

  @Post(':id/attachment')
  attach(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AttachInvoiceScanFileDto,
  ) {
    return this.invoiceScans.prepareFileAttachment(id, body);
  }

  @Post(':id/attachment/complete')
  completeAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CompleteInvoiceScanAttachmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoiceScans.completeFileAttachment(id, body, user);
  }

  @Get(':id/download')
  download(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoiceScans.getDownloadUrl(id);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoiceScans.remove(id);
  }
}
