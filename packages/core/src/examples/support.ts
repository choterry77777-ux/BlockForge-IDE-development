import type { LanguageId } from '../types';

/**
 * Example programs a language cannot express. Their generators must report a
 * `gen.unsupported` diagnostic instead of emitting wrong code; tests enforce it.
 */
export const UNSUPPORTED: Record<string, LanguageId[]> = {
  dictionary: ['c'],
  exceptions: ['c', 'rust', 'bash'],
  structs: ['bash'],
  classes: ['c', 'bash'],
  globals: ['rust'],
};
