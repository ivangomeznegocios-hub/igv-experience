import type { CheckupCategory, HealthFileRef, HealthMetricKind, HealthRecordType } from '@igv/core';
import { AuthError, req } from './api';

/** Cliente de /api/medico (tu médico IA y archivos de Salud). Los tipos reflejan apps/api/src/medico.ts. */

export interface MedicoStatus {
  enabled: boolean;
  model: string;
  files: number;
  bytes: number;
  maxBytes: number;
}

export interface ReadValue {
  name: string;
  kind: Exclude<HealthMetricKind, 'otro'> | null;
  value: number | null;
  value2: number | null;
  text: string | null;
  unit: string | null;
  ref: string | null;
  low: number | null;
  high: number | null;
  flag: 'alto' | 'bajo' | 'anormal' | null;
}

export interface ReadResult {
  title: string;
  type: HealthRecordType;
  date: string | null;
  place: string | null;
  doctor: string | null;
  cost: number | null;
  summary: string;
  findings: string[];
  values: ReadValue[];
  recommendations: string[];
  checkup: string | null;
}

export interface ConsultResult {
  title: string;
  message: string;
  status: 'bien' | 'atencion' | 'importante';
  highlights: { tone: 'bien' | 'atencion' | 'pendiente'; text: string }[];
  actions: {
    text: string;
    why: string;
    type: 'chequeo' | 'medicion' | 'estudio' | 'consulta' | 'habito' | 'dato';
    priority: 'alta' | 'media' | 'baja';
    checkup: { name: string; category: CheckupCategory; everyMonths: number } | null;
    metric: Exclude<HealthMetricKind, 'otro'> | null;
  }[];
  missing: string[];
  nextReviewDays: number;
}

export const medicoApi = {
  status: () => req<MedicoStatus>('/medico/status'),
  /** Sube un archivo (base64 sin el prefijo data:). */
  upload: async (name: string, mime: string, b64: string): Promise<HealthFileRef> => {
    const res = await fetch(`/api/medico/files?name=${encodeURIComponent(name)}&mime=${encodeURIComponent(mime)}`, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'manual',
      headers: { 'Content-Type': 'text/plain' },
      body: b64,
    });
    if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) throw new AuthError('Sesión expirada');
    const body = (await res.json().catch(() => ({}))) as HealthFileRef & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
    return body;
  },
  file: (id: string) => req<HealthFileRef & { data: string }>(`/medico/files/${encodeURIComponent(id)}`),
  deleteFile: (id: string) => req<{ ok: true }>(`/medico/files/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  read: (body: { fileIds: string[]; today: string; profile?: string; hint?: { title?: string | null; type?: string | null; date?: string | null; notes?: string | null } }) =>
    req<ReadResult>('/medico/read', { method: 'POST', body: JSON.stringify(body) }),
  consult: (body: { dossier: string; today: string; kind: 'auto' | 'pedida' | 'inicial'; focus?: string }) => req<ConsultResult>('/medico/consult', { method: 'POST', body: JSON.stringify(body) }),
  ask: (body: { dossier: string; today: string; question: string; history: { role: 'user' | 'assistant'; content: string }[]; fileIds?: string[] }) =>
    req<{ answer: string }>('/medico/ask', { method: 'POST', body: JSON.stringify(body) }),
};
