import { z } from 'zod';

export function enumFromTsEnum<T extends Record<string, string>>(enumObj: T) {
  return z.enum(Object.values(enumObj) as [string, ...string[]]);
}
