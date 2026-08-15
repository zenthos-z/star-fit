/**
 * Type Guard Utilities
 * 
 * Centralized location for type guard functions to ensure type safety across the backend application.
 */

/**
 * Checks if a value is a valid JSON string that parses to an object or array.
 * @param value The value to check
 */
export function isStringJson(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
}

/**
 * Checks if a value is a non-null object.
 * @param value The value to check
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks if a value is a non-null object or array.
 * @param value The value to check
 */
export function isObjectOrArray(value: unknown): value is Record<string, unknown> | unknown[] {
  return typeof value === 'object' && value !== null;
}

/**
 * Checks if a value is a valid MuscleGroups object structure.
 * @param value The value to check
 */
export function isMuscleGroupsObject(value: unknown): value is {
  primary: { name: string }[];
  secondary: { name: string }[];
  stabilizers: { name: string }[];
} {
  if (!isObject(value)) return false;
  
  const hasArrayProp = (prop: string) => 
    Array.isArray(value[prop]) && 
    (value[prop] as any[]).every(item => isObject(item) && typeof (item as any).name === 'string');

  return hasArrayProp('primary') && hasArrayProp('secondary') && hasArrayProp('stabilizers');
}
