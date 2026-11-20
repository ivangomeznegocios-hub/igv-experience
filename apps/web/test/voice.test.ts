import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Dictation, appendSpeech } from '../src/lib/voice';

/** Reconocedor de voz simulado: las pruebas disparan resultados y cierres como el navegador. */
class FakeRec {
  static last: FakeRec | null = null;
  static count = 0;
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((ev: { resultIndex?: number; results: ArrayLike<{ isFinal: boolean; length: number; [i: number]: { transcript: string } }> }) => void) | null = null;
  onerror: ((ev: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  stopped = false;
  constructor() {
    FakeRec.last = this;
    FakeRec.count++;
  }
  start() {}
  stop() {
    this.stopped = true;
  }
  abort() {}
  say(text: string, isFinal = true) {
    const r = Object.assign([{ transcript: text }], { isFinal });
    this.onresult?.({ resultIndex: 0, results: [r] });
  }
  end() {
    this.onend?.();
  }
}

const g = globalThis as unknown as { window?: unknown; navigator?: unknown };
beforeEach(() => {
  FakeRec.last = null;
  FakeRec.count = 0;
  g.window = { webkitSpeechRecognition: FakeRec };
});
afterEach(() => {
  delete g.window;
});

describe('Dictation', () => {
  it('usa el idioma pedido (es-MX por defecto, en-US para inglés)', () => {
    new Dictation().start();
    expect(FakeRec.last!.lang).toBe('es-MX');
    new Dictation('en-US').start();
    expect(FakeRec.last!.lang).toBe('en-US');
  });

  it('entrega cada pedazo final y quita lo repetido acumulado', () => {
    const d = new Dictation();
    const got: string[] = [];
    d.setOnFinal((t) => got.push(t));
    d.start();
    FakeRec.last!.say('fui al gym');
    FakeRec.last!.say('fui al gym y leí');
    expect(got).toEqual(['fui al gym', 'y leí']);
  });

  it('no se come una palabra dicha dos veces seguidas (fuera de Android)', () => {
    const d = new Dictation();
    const got: string[] = [];
    d.setOnFinal((t) => got.push(t));
    d.start();
    FakeRec.last!.say('sí');
    FakeRec.last!.say('sí');
    expect(got).toEqual(['sí', 'sí']);
  });

  it('se reinicia solo cuando el navegador corta por silencio', () => {
    const d = new Dictation();
    d.start();
    FakeRec.last!.end();
    expect(FakeRec.count).toBe(2);
    expect(d.state.listening).toBe(true);
  });

  it('al detener entrega lo último que estaba en el aire si no llegó como final', () => {
    const d = new Dictation();
    const got: string[] = [];
    d.setOnFinal((t) => got.push(t));
    d.start();
    FakeRec.last!.say('compré pan', false);
    d.stop();
    FakeRec.last!.end();
    expect(got).toEqual(['compré pan']);
    expect(d.state.listening).toBe(false);
    expect(FakeRec.count).toBe(1);
  });

  it('volver a tocar mientras se detiene sigue escuchando', () => {
    const d = new Dictation();
    d.start();
    d.stop();
    d.start();
    FakeRec.last!.end();
    expect(FakeRec.count).toBe(2);
    expect(d.state.listening).toBe(true);
  });

  it('solo un dictado a la vez', () => {
    const a = new Dictation();
    const b = new Dictation();
    a.start();
    b.start();
    expect(a.state.listening).toBe(false);
    expect(b.state.listening).toBe(true);
  });

  it('sin dictado en el navegador avisa sin romper', () => {
    g.window = {};
    const d = new Dictation();
    expect(d.start()).toBe(false);
    expect(d.state.code).toBe('no-support');
  });
});

describe('appendSpeech', () => {
  it('agrega al final con mayúscula inicial y después de punto', () => {
    expect(appendSpeech('', 'fui al gym')).toBe('Fui al gym');
    expect(appendSpeech('Fui al gym', 'y leí')).toBe('Fui al gym y leí');
    expect(appendSpeech('Listo.', 'mañana sigo')).toBe('Listo. Mañana sigo');
    expect(appendSpeech('Algo', '  ')).toBe('Algo');
  });
});
