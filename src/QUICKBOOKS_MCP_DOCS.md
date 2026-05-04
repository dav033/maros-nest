# Documentación Completa del Servidor MCP (CRM & QuickBooks)

Este documento describe todas las herramientas (tools) disponibles en el servidor MCP para interactuar tanto con el CRM de Maros como con QuickBooks Online (QBO).

---

## 1. CRM - Leads (Prospectos)

### Lectura de Leads
- **`get_all_leads`**: Obtiene todos los leads del pipeline (excluye leads con proyectos o en revisión).
- **`get_lead_by_id` / `get_lead_by_number`**: Obtiene un lead específico por su ID numérico o su número correlativo (e.g. C-001).
- **`get_lead_details`**: Obtiene el detalle completo incluyendo información del proyecto asociado.
- **`get_leads_in_review`**: Lista leads en estado de revisión.
- **`get_leads_by_status`**: Filtra leads por estado (New, Contacted, Proposal, etc.).
- **`search_leads`**: Busca leads por nombre, ubicación o número (coincidencia parcial).

### Escritura de Leads
- **`create_lead_with_existing_contact`**: Crea un lead asociado a un contacto ya existente.
- **`create_lead_with_new_contact`**: Crea un lead y un contacto nuevo simultáneamente.
- **`update_lead`**: Actualiza campos de un lead existente por su ID.
- **`delete_lead`**: Elimina un lead. Opcionalmente puede eliminar el contacto y la empresa asociados.

**Salida técnica esperada**: Objetos `Lead` con campos como `id`, `leadNumber`, `name`, `status`, `location`, `contact`, `project`, etc.

---

## 2. CRM - Companies (Empresas)

- **`get_all_companies`**: Lista todas las empresas.
- **`get_company_by_id` / `search_companies_by_name`**: Busca empresas por ID o coincidencia parcial de nombre.
- **`get_companies_by_type`**: Filtra por tipo (Customer, Client, Supplier, Subcontractor).
- **`get_company_full_profile`**: Perfil exhaustivo: contactos asociados, sus leads, proyectos y estadísticas resumidas.
- **`create_company` / `update_company` / `delete_company`**: Operaciones CRUD para empresas.

**Salida técnica esperada**: Objetos `Company` con `id`, `name`, `type`, `address`, `contacts[]`, etc.

---

## 3. CRM - Contacts (Contactos)

- **`get_all_contacts`**: Lista todos los contactos con su información de empresa.
- **`get_contact_details`**: Detalle completo: todos sus leads, proyectos y estadísticas.
- **`search_contacts`**: Búsqueda por nombre, email o teléfono (parcial).
- **`create_contact` / `update_contact` / `delete_contact`**: Operaciones CRUD para contactos.

**Salida técnica esperada**: Objetos `Contact` con `id`, `name`, `email`, `phone`, `company`, `leads[]`, `projects[]`, etc.

---

## 4. CRM - Projects (Proyectos)

- **`get_all_projects`**: Lista todos los proyectos con info de lead y contacto.
- **`get_project_details`**: Detalle profundo incluyendo lead, contacto y empresa.
- **`get_projects_by_status`**: Filtra por estado de progreso (In Progress, Completed, etc.).
- **`create_project`**: Crea un proyecto a partir de un lead existente.
- **`update_project` / `delete_project`**: Gestión de proyectos existentes.

**Salida técnica esperada**: Objetos `Project` con `id`, `invoiceAmount`, `projectProgressStatus`, `invoiceStatus`, `lead`, `contact`, etc.

---

## 5. QuickBooks Online (QBO)

### Estructura General de Respuesta (Job Costing)
Las herramientas de "Job Costing" (prefijo `qbo_`) retornan:
- **summary**: Resumen ejecutivo.
- **details**: Desglose detallado.
- **warnings**: Advertencias encontradas.
- **coverage**: Alcance de la búsqueda.

### Herramientas de Proyecto y Finanzas
- **`get_project_financials`**: Resumen agregado de montos (estimado, facturado, pagado, pendiente) para uno o más proyectos.
- **`get_project_detail`**: Registro QBO del trabajo, estimaciones, facturas y pagos normalizados.
- **`get_unbilled_work`**: Diferencia entre lo estimado y lo facturado.
- **`get_project_full_profile`**: Todo lo anterior más gastos de proveedores, adjuntos y P&L del proyecto.

### Herramientas de Costeo (Job Costing)
- **`qbo_get_project_job_cost_summary`**: Resumen completo: contrato, facturas, cash out pagado, cuentas por pagar, P&L y utilidad.
- **`qbo_get_project_cash_out`**: Detalle de gastos reales: compras, cheques, tarjetas, etc.
- **`qbo_get_project_ap_status`**: Cuentas por pagar abiertas con antigüedad y saldos.

### Proveedores y Reportes
- **`list_qbo_vendors`**: Lista normalizada de proveedores de QBO.
- **`match_crm_companies_to_qbo_vendors`**: Vinculación inteligente entre CRM y QBO.
- **`get_profit_and_loss_detail`**: P&L detallado con cada transacción de ingreso/gasto.
- **`get_aging_report`**: Antigüedad de cuentas por cobrar (A/R).

### Acceso Directo (Proxy)
- **`qb_get_invoice`, `qb_get_payment`, `qb_get_estimate`**: Obtención directa del objeto normalizado por su ID de QBO.

---

## Tipos de Datos Técnicos Clave

### `QboNormalizedTransaction`
```typescript
{
  source: 'quickbooks';
  direction: 'cash_in' | 'cash_out' | 'ap_open' | 'commitment' | 'credit' | 'adjustment';
  entityType: string; // Invoice, Bill, Purchase, etc.
  entityId: string;
  docNumber: string;
  txnDate: string;
  totalAmount: number;
  lineItems: Array<{
    amount: number;
    description: string;
    account?: { value: string; name: string };
    projectRefs: Array<{ value: string; name: string }>;
  }>;
  attachments: QboAttachmentSummary[];
}
```
