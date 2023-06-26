const buyRecordSchema = {
  $id: '#/definitions/buyRecord',
  type: 'object',
  properties: {
    function: {
      type: 'string',
      const: 'buyRecord',
    },
    name: {
      type: 'string',
      pattern: '^([a-zA-Z0-9][a-zA-Z0-9-]{0,30}[a-zA-Z0-9]|[a-zA-Z0-9]{1})$',
    },
    contractTxId: {
      type: 'string',
      pattern: '^(atomic|[a-zA-Z0-9-_]{43})$',
    },
    years: {
      type: 'integer',
      minimum: 1,
    },
    qty: {
      type: 'number',
      minimum: 0,
    },
    tier: {
      type: 'string',
      pattern: '^[a-zA-Z0-9-]{43}$',
    },
    type: {
      type: 'string',
      pattern: '^(lease|permabuy)$',
    },
  },
  required: ['name', 'function'],
  additionalProperties: false,
};

module.exports = {
  buyRecordSchema,
};