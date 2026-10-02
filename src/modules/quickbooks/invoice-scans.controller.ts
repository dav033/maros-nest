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
import { CreateManualInvoiceTransactionDto } from './dto/create-manual-invoice-transaction.dto';
import { CreateInvoiceScanDto } from './dto/create-invoice-scan.dto';
import { UpdateInvoiceScanDto } from './dto/update-invoice-scan.dto';
import { InvoiceScansService } from './services/invoice-scans.service';

@ApiTags('Invoice scans')
@Controller('invoice-scans')
@RequirePermissions('finance:write')
export class InvoiceScansController {
  constructor(private readonly invoiceScans: InvoiceScansService) {}

  @Get()
  list() {
    return this.invoiceScans.list();
  }

  /** Declared before `:id` so the literal segment wins the route match. */
  @Get('counterparties')
  counterparties() {
    return this.invoiceScans.listQboCounterparties();
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
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoiceScans.attachFile(id, body, user);
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
