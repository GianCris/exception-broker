import { exceptionCaseSchema } from './schemas.js';

export const case001Fixture = exceptionCaseSchema.parse({
  id: 'CASE-001',
  status: 'open',
  createdAt: '2026-08-03T14:00:00.000Z',
  requiredBy: '2026-08-05T18:00:00.000Z',
  currency: 'USD',
  parties: [
    {
      id: 'PARTY-REQUESTER-001',
      role: 'requester',
      organizationName: 'Northstar Retail',
      contact: { name: 'Ana Torres', phone: '+1-202-555-0101' },
    },
    {
      id: 'PARTY-SUPPLIER-001',
      role: 'supplier',
      organizationName: 'Acme Supply',
      contact: { name: 'Bruno Silva', phone: '+1-202-555-0102' },
    },
    {
      id: 'PARTY-CARRIER-001',
      role: 'carrier',
      organizationName: 'Rapid Freight',
      contact: { name: 'Carla Ruiz', phone: '+1-202-555-0103' },
    },
  ],
  items: [
    {
      id: 'ITEM-001',
      sku: 'SKU-1001',
      description: 'Replacement component',
      requestedQuantity: 100,
      availableQuantity: 60,
      unitCost: 12.5,
    },
  ],
});

