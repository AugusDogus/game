/**
 * Safe access utilities that throw descriptive errors instead of using non-null assertions.
 * Use these throughout the codebase to avoid `!` assertions.
 */

/**
 * Get an element from an array at a specific index, throwing if out of bounds.
 */
export function getAt<T>(array: T[], index: number, description = "array"): T {
  if (index < 0 || index >= array.length) {
    throw new Error(
      `Index ${index} out of bounds for ${description} with length ${array.length}`
    );
  }
  const value = array[index];
  if (value === undefined) {
    throw new Error(`Unexpected undefined at index ${index} in ${description}`);
  }
  return value;
}

/**
 * Get the first element from an array, throwing if empty.
 */
export function getFirst<T>(array: T[], description = "array"): T {
  if (array.length === 0) {
    throw new Error(`Cannot get first element of empty ${description}`);
  }
  return getAt(array, 0, description);
}

/**
 * Get the last element from an array, throwing if empty.
 */
export function getLast<T>(array: T[], description = "array"): T {
  if (array.length === 0) {
    throw new Error(`Cannot get last element of empty ${description}`);
  }
  return getAt(array, array.length - 1, description);
}

/**
 * Get a value from a Map, throwing if not found.
 */
export function getFromMap<K, V>(map: Map<K, V>, key: K, description = "map"): V {
  const value = map.get(key);
  if (value === undefined) {
    const availableKeys = Array.from(map.keys())
      .map((k) => String(k))
      .join(", ");
    throw new Error(
      `Key "${String(key)}" not found in ${description}. Available keys: [${availableKeys}]`
    );
  }
  return value;
}

/**
 * Get a value from a Map, or set and return a default if not found.
 * This is useful for the pattern: if (!map.has(key)) map.set(key, default); return map.get(key)!;
 */
export function getOrSet<K, V>(map: Map<K, V>, key: K, defaultValue: () => V): V {
  const existing = map.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const value = defaultValue();
  map.set(key, value);
  return value;
}

/**
 * Assert a value is defined and return it with proper typing.
 */
export function assertDefined<T>(
  value: T | undefined | null,
  description = "value"
): T {
  if (value === undefined || value === null) {
    throw new Error(`Expected ${description} to be defined, but got ${value}`);
  }
  return value;
}
