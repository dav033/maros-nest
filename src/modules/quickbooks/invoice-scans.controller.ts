import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
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

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoiceScans.get(id);
  }

  @Post()
  create(@Body() body: CreateInvoiceScanDto) {
    return this.invoiceScans.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateInvoiceScanDto,
  ) {
    return this.invoiceScans.update(id, body);
  }

  @Post(':id/scan')
  scan(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoiceScans.scan(id);
  }
}
