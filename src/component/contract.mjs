const defaults = {
  type: 'object',
  properties: {
    walkingSpeed: { type: 'integer', minimum: 0, maximum: 32 },
    dashDistance: { type: 'integer', minimum: 1, maximum: 4096 },
    cooldownTicks: { type: 'integer', minimum: 0, maximum: 600 },
    initialCooldownTicks: { type: 'integer', minimum: 0, maximum: 600 },
  },
  required: ['walkingSpeed', 'dashDistance', 'cooldownTicks', 'initialCooldownTicks'], additionalProperties: false,
};
export const SUBMIT_MOTION = {
  type: 'function', name: 'submit_motion_candidate', strict: true,
  description: 'Submit standalone TypeScript and a behavioral contract for independent donor comparison. This requests evaluation and cannot mark the component accepted.',
  parameters: {
    type: 'object',
    properties: {
      source: { type: 'string', minLength: 1, maxLength: 16_384 },
      contract: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 80 },
          scope: { type: 'string', minLength: 1, maxLength: 500 },
          defaults,
          stateDescription: { type: 'string', minLength: 1, maxLength: 1000 },
          rules: {
            type: 'array', minItems: 1, maxItems: 12,
            items: { type: 'object', properties: {
              description: { type: 'string', minLength: 1, maxLength: 500 },
              evidence: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', maxLength: 80 } },
            }, required: ['description', 'evidence'], additionalProperties: false },
          },
          limitations: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 500 } },
        },
        required: ['name', 'scope', 'defaults', 'stateDescription', 'rules', 'limitations'], additionalProperties: false,
      },
    },
    required: ['source', 'contract'], additionalProperties: false,
  },
};

// Validate the subset of JSON Schema used by this submission tool locally too.
function validate(value, schema, path) {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== schema.required.length || schema.required.some(key => !Object.hasOwn(value, key))) {
      throw new Error(`Invalid fields at ${path}`);
    }
    for (const [key, property] of Object.entries(schema.properties)) validate(value[key], property, `${path}.${key}`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > schema.maxItems) throw new Error(`Invalid array at ${path}`);
    value.forEach(item => validate(item, schema.items, path));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || !value.trim() || value.length < (schema.minLength ?? 1) || value.length > schema.maxLength) throw new Error(`Invalid string at ${path}`);
  } else if (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum) {
    throw new Error(`Invalid integer at ${path}`);
  }
}

export function validateMotionCandidate(candidate, evidence) {
  validate(candidate, SUBMIT_MOTION.parameters, 'candidate');
  if (Buffer.byteLength(candidate.source) > 16_384) throw new Error('Component source exceeds 16 KB');
  const ids = new Set([...evidence.functions, ...evidence.traces].map(item => item.id));
  for (const rule of candidate.contract.rules) {
    if (rule.evidence.some(id => !ids.has(id))) throw new Error('Contract cites unknown evidence');
  }
}
