/**
 * Cuenta las consultas a D1 de una invocación. En el plan gratis de Workers, D1 permite 50 consultas por
 * invocación: el Coach (que ejecuta varias herramientas en una sola petición) se detiene antes de llegar.
 */
export interface QueryCounter {
  count: number;
}

export function countingD1(d1: D1Database, counter: QueryCounter): D1Database {
  return new Proxy(d1, {
    get(target, prop, receiver) {
      if (prop === 'prepare') {
        return (sql: string) => {
          counter.count++;
          return target.prepare(sql);
        };
      }
      if (prop === 'exec') {
        return (sql: string) => {
          counter.count++;
          return target.exec(sql);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}
