import fs from "node:fs";

const TYPE_CHECKS = {
  string: (value) => typeof value === "string",
  number: (value) => typeof value === "number" && Number.isFinite(value),
  integer: (value) => Number.isInteger(value),
  object: (value) => value && typeof value === "object" && !Array.isArray(value),
  array: (value) => Array.isArray(value)
};

export function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

export function validateContract(schema, payload, path = schema.title || "payload") {
  const errors = [];
  validateNode(schema, payload, path, errors);
  return { valid: errors.length === 0, errors };
}

function validateNode(schema, value, path, errors) {
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path} must equal ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of ${schema.enum.join(", ")}`);
  }

  if (schema.type) {
    const check = TYPE_CHECKS[schema.type];
    if (check && !check(value)) {
      errors.push(`${path} must be ${schema.type}`);
      return;
    }
  }

  if (schema.required && TYPE_CHECKS.object(value)) {
    for (const key of schema.required) {
      if (!(key in value)) errors.push(`${path}.${key} is required`);
    }
  }

  if (schema.additionalProperties === false && schema.properties && TYPE_CHECKS.object(value)) {
    for (const key of Object.keys(value)) {
      if (!schema.properties[key]) errors.push(`${path}.${key} is not allowed`);
    }
  }

  if (schema.minLength !== undefined && typeof value === "string" && value.length < schema.minLength) {
    errors.push(`${path} length must be >= ${schema.minLength}`);
  }

  if (schema.minimum !== undefined && typeof value === "number" && value < schema.minimum) {
    errors.push(`${path} must be >= ${schema.minimum}`);
  }

  if (schema.maximum !== undefined && typeof value === "number" && value > schema.maximum) {
    errors.push(`${path} must be <= ${schema.maximum}`);
  }

  if (schema.exclusiveMinimum !== undefined && typeof value === "number" && value <= schema.exclusiveMinimum) {
    errors.push(`${path} must be > ${schema.exclusiveMinimum}`);
  }

  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${path} does not match ${schema.pattern}`);
  }

  if (schema.format === "date-time" && typeof value === "string" && Number.isNaN(Date.parse(value))) {
    errors.push(`${path} must be an ISO date-time`);
  }

  if (schema.minItems !== undefined && Array.isArray(value) && value.length < schema.minItems) {
    errors.push(`${path} must contain at least ${schema.minItems} item(s)`);
  }

  if (schema.properties && TYPE_CHECKS.object(value)) {
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (value[key] !== undefined) validateNode(childSchema, value[key], `${path}.${key}`, errors);
    }
  }

  if (schema.items && Array.isArray(value)) {
    value.forEach((item, index) => validateNode(schema.items, item, `${path}[${index}]`, errors));
  }
}
