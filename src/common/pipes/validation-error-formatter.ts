import { ValidationError } from 'class-validator';

export interface FlatValidationError {
  field: string;
  message: string;
}

function joinPath(parentPath: string, property: string): string {
  const isArrayIndex = /^\d+$/.test(property);
  if (!parentPath) {
    return property;
  }
  return isArrayIndex
    ? `${parentPath}[${property}]`
    : `${parentPath}.${property}`;
}

// class-validator's ValidationError is a tree (nested DTOs / arrays produce
// `children`); the contract wants a flat list of {field, message}, field
// using dot/bracket notation (e.g. items[0].quantity).
export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): FlatValidationError[] {
  const flattened: FlatValidationError[] = [];

  for (const error of errors) {
    const field = joinPath(parentPath, error.property);

    if (error.constraints) {
      for (const message of Object.values(error.constraints)) {
        flattened.push({ field, message });
      }
    }

    if (error.children && error.children.length > 0) {
      flattened.push(...flattenValidationErrors(error.children, field));
    }
  }

  return flattened;
}
