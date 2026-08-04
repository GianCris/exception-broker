import { exceptionCaseSchema } from './schemas.js';

const tomorrowAtFive = '2026-08-04T17:00:00-05:00';
const fridayAtFive = '2026-08-07T17:00:00-05:00';

export const case001Fixture = exceptionCaseSchema.parse({
  id: 'CASE-001',
  status: 'CASE_CREATED',
  quantity: 400,
  deliveryDate: tomorrowAtFive,
  additionalCost: 0,
  actors: [
    {
      id: 'supplier',
      role: 'supplier',
      constraints: [
        {
          quantity: 200,
          deliveryDate: tomorrowAtFive,
          additionalCost: 0,
        },
        {
          quantity: 200,
          deliveryDate: fridayAtFive,
          additionalCost: 0,
        },
      ],
      authorization: {
        quantity: 400,
        deliveryDate: fridayAtFive,
        additionalCost: 0,
      },
    },
    {
      id: 'production',
      role: 'production',
      constraints: [
        {
          quantity: 300,
          deliveryDate: tomorrowAtFive,
          additionalCost: 0,
        },
      ],
      authorization: {
        quantity: 300,
        deliveryDate: tomorrowAtFive,
        additionalCost: 0,
      },
    },
    {
      id: 'client',
      role: 'client',
      constraints: [
        {
          quantity: 300,
          deliveryDate: tomorrowAtFive,
          additionalCost: 0,
        },
      ],
      authorization: {
        quantity: 50,
        deliveryDate: tomorrowAtFive,
        additionalCost: 0,
      },
    },
  ],
});

