import { exceptionCaseSchema } from './schemas.js';

export const case001TomorrowAtFive = '2026-08-04T17:00:00-05:00';
export const case001FridayAtFive = '2026-08-07T17:00:00-05:00';

export const case001Fixture = exceptionCaseSchema.parse({
  id: 'CASE-001',
  status: 'CASE_CREATED',
  requestedQuantity: 400,
  targetDeliveryDate: case001TomorrowAtFive,
  actors: [
    {
      id: 'supplier',
      role: 'supplier',
      constraints: [
        {
          type: 'SUPPLY',
          originalQuantity: 200,
          substituteQuantity: 0,
          deliveryDate: case001TomorrowAtFive,
          substituteUnitAdditionalCost: 0,
        },
        {
          type: 'SUPPLY',
          originalQuantity: 200,
          substituteQuantity: 0,
          deliveryDate: case001FridayAtFive,
          substituteUnitAdditionalCost: 0,
        },
        {
          type: 'SUPPLY',
          originalQuantity: 0,
          substituteQuantity: 200,
          deliveryDate: case001TomorrowAtFive,
          substituteUnitAdditionalCost: 0.5,
        },
      ],
      authorization: {
        maxAbsorbableAdditionalCost: 60,
        maxSubstituteQuantity: 200,
        latestAcceptedDeliveryDate: case001FridayAtFive,
      },
    },
    {
      id: 'production',
      role: 'production',
      constraints: [
        {
          type: 'MINIMUM_DELIVERY',
          minimumRequiredQuantity: 300,
          deliveryDate: case001TomorrowAtFive,
          allowsOriginalAndSubstituteMix: true,
        },
      ],
      authorization: {
        maxAbsorbableAdditionalCost: 20,
        maxSubstituteQuantity: 400,
        latestAcceptedDeliveryDate: case001FridayAtFive,
      },
    },
    {
      id: 'client',
      role: 'client',
      constraints: [
        {
          type: 'MINIMUM_DELIVERY',
          minimumRequiredQuantity: 300,
          deliveryDate: case001TomorrowAtFive,
          allowsOriginalAndSubstituteMix: true,
        },
        {
          type: 'MINIMUM_DELIVERY',
          minimumRequiredQuantity: 100,
          deliveryDate: case001FridayAtFive,
          allowsOriginalAndSubstituteMix: true,
        },
      ],
      authorization: {
        maxAbsorbableAdditionalCost: 0,
        maxSubstituteQuantity: 50,
        latestAcceptedDeliveryDate: case001FridayAtFive,
      },
    },
  ],
});
