import { z } from 'zod';
import type { Entity, GameEvent } from './types';

export const BACKUP_VERSION = 1;

export interface Backup {
  app: 'igv-experience';
  version: number;
  exportedAt: string;
  events: GameEvent[];
  entities: Entity[];
}

export const backupSchema = z.object({
  app: z.literal('igv-experience'),
  version: z.number().int().min(1),
  exportedAt: z.string(),
  events: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      occurredAt: z.string(),
      localDate: z.string(),
      payload: z.unknown(),
      voidedAt: z.string().nullish(),
      createdAt: z.number().optional(),
      updatedAt: z.number().optional(),
    }),
  ),
  entities: z.array(
    z.object({
      id: z.string(),
      module: z.string(),
      kind: z.string(),
      data: z.unknown(),
      sort: z.number(),
      createdAt: z.number().optional(),
      updatedAt: z.number().optional(),
      deletedAt: z.number().nullish(),
    }),
  ),
});
