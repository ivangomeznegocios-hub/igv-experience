import { req } from './api';

/** Cliente de /api/learn (tests con IA). Los tipos reflejan apps/api/src/learn.ts. */

export type QuestionType = 'traducir' | 'completar' | 'opcion' | 'corregir' | 'responder';

export interface LearnTopicInput {
  name: string;
  kind: 'idioma' | 'materia' | 'otro';
  level?: string | null;
  goal?: string | null;
}

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  instruction: string;
  prompt: string;
  options: string[] | null;
  expected: string;
  tag: string;
}

export interface QuizResponse {
  title: string;
  questions: QuizQuestion[];
}

export interface GradeResult {
  id: string;
  correct: boolean;
  corrected: string | null;
  wrong: string | null;
  fix: string | null;
  tag: string | null;
  explanation: string | null;
}

export interface GradeResponse {
  score: number;
  total: number;
  estimatedLevel: string | null;
  feedback: string;
  results: GradeResult[];
  errors: { tag: string; prompt: string; answer: string; correction: string; explanation?: string }[];
  suggestions: { text: string; meaning: string; example: string | null; tags: string[] }[];
}

export const learnApi = {
  status: () => req<{ enabled: boolean }>('/learn/status'),
  quiz: (body: {
    topic: LearnTopicInput;
    count: number;
    focus?: string | null;
    known: string[];
    learning: string[];
    errors: { tag: string; answer: string; correction: string; count: number }[];
  }) => req<QuizResponse>('/learn/quiz', { method: 'POST', body: JSON.stringify(body) }),
  grade: (body: {
    topic: LearnTopicInput;
    questions: (QuizQuestion & { answer: string })[];
    knownErrors: { tag: string; correction: string }[];
    existing: string[];
  }) => req<GradeResponse>('/learn/grade', { method: 'POST', body: JSON.stringify(body) }),
};
