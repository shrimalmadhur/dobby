/**
 * Env var keys that must not be overridden by agent config.
 * Shared between agent runner (deny-list enforcement) and validation schemas.
 */
export const DENIED_ENV_KEYS = new Set([
  "PATH", "LD_PRELOAD", "LD_LIBRARY_PATH", "NODE_OPTIONS",
  "HOME", "SHELL", "USER", "LOGNAME", "DYLD_INSERT_LIBRARIES",
]);
