/**
 * Test utilities providing safe access to values that might be undefined.
 * These helpers throw descriptive errors instead of using non-null assertions.
 *
 * NOTE: For production code, use the helpers in core/utils.ts instead.
 * This file re-exports those for convenience.
 */

export { getAt, getLast, getFromMap, assertDefined } from "./core/utils.js";
