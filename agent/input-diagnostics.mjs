import { TOOLS } from './tool-schema.mjs';

/** Describe structural mistakes only. Never supply behavioral expectations. */
export function inputDiagnostics(name, args) {
  const schema = TOOLS.find(tool => tool.name === name)?.parameters;
  function inspect(value, shape, path) {
    if (shape?.type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { path, expectedType: 'object', requiredFields: shape.required };
      const missingFields = shape.required.filter(key => !Object.hasOwn(value, key));
      const unknownFields = Object.keys(value).filter(key => !Object.hasOwn(shape.properties, key));
      if (missingFields.length || unknownFields.length) return { path, missingFields, unknownFields, requiredFields: shape.required };
      for (const [key, child] of Object.entries(shape.properties)) {
        const issue = inspect(value[key], child, path + '.' + key); if (issue) return issue;
      }
    } else if (shape?.type === 'array') {
      if (!Array.isArray(value)) return { path, expectedType: 'array' };
      for (let i = 0; i < value.length; i++) { const issue = inspect(value[i], shape.items, path + '[' + i + ']'); if (issue) return issue; }
    }
    return null;
  }
  return schema ? inspect(args, schema, 'tool') : null;
}

export function recoverySelectionHelp(name, session, error) {
  if (name !== 'select_component_evidence' || !error.includes('unknown session execution evidence')) return null;
  return { notice: 'Choose inspected code in functionIndices. evidenceIds accepts actual execution/finding IDs, not binary function IDs.',
    availableExecutionIds: [...new Set([
      ...(session?.observations ?? []).map(item => item.id), ...(session?.comparisons ?? []).map(item => item.comparisonId),
      ...(session?.annotations ?? []).map(item => item.id),
      ...(session?.staticEvidence ?? []).filter(item => item.kind === 'experiment').flatMap(item => [item.id, item.artifactId]),
    ].filter(Boolean))].slice(-12) };
}
