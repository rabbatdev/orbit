// A fluent query builder producing an AST, mirroring Zero's `zero-client` query
// API (`.where()`, `.related()`, `.orderBy()`, `.limit()`, `.start()`, `.one()`).

import type { AST, Condition, Correlation, Direction, SimpleOperator, Value, Row } from './protocol.ts';
import type { RowOf, SchemaDef } from './schema.ts';

export class Query {
  #ast: AST;
  /** `.one()` was called — a related parent should treat this as singular. */
  #singular: boolean;

  private constructor(ast: AST, singular = false) {
    this.#ast = ast;
    this.#singular = singular;
  }

  static from(table: string): Query {
    return new Query({ table });
  }

  where(field: string, op: SimpleOperator, value: Value | readonly (string | number | boolean)[]): Query {
    const cond: Condition = {
      type: 'simple',
      op,
      left: { type: 'column', name: field },
      right: { type: 'literal', value },
    };
    return new Query({ ...this.#ast, where: and(this.#ast.where, cond) }, this.#singular);
  }

  whereExists(correlation: Correlation, subquery: Query, negated = false): Query {
    const cond: Condition = {
      type: 'correlatedSubquery',
      related: { correlation, subquery: subquery.ast() },
      op: negated ? 'NOT EXISTS' : 'EXISTS',
    };
    return new Query({ ...this.#ast, where: and(this.#ast.where, cond) }, this.#singular);
  }

  related(name: string, correlation: Correlation, subquery: Query): Query {
    const sub = { ...subquery.ast(), alias: name };
    const entry = { correlation, subquery: sub, singular: subquery.#singular || undefined };
    const related = [...(this.#ast.related ?? []), entry];
    return new Query({ ...this.#ast, related }, this.#singular);
  }

  orderBy(field: string, dir: Direction): Query {
    const orderBy = [...(this.#ast.orderBy ?? []), [field, dir] as const];
    return new Query({ ...this.#ast, orderBy }, this.#singular);
  }

  limit(n: number): Query {
    return new Query({ ...this.#ast, limit: n }, this.#singular);
  }

  one(): Query {
    return new Query({ ...this.#ast, limit: 1 }, true);
  }

  start(row: Row, exclusive = false): Query {
    return new Query({ ...this.#ast, start: { row, exclusive } }, this.#singular);
  }

  /** Whether this query was marked `.one()` (singular). */
  isSingular(): boolean {
    return this.#singular;
  }

  ast(): AST {
    return this.#ast;
  }
}

function and(existing: Condition | undefined, next: Condition): Condition {
  if (!existing) return next;
  if (existing.type === 'and') return { type: 'and', conditions: [...existing.conditions, next] };
  return { type: 'and', conditions: [existing, next] };
}

// --- typed query ------------------------------------------------------------

/** A live view's read surface (avoids a circular import on `View`). */
export type ViewLike<T> = {
  data: T[];
  subscribe(fn: () => void): () => void;
  /** Release the view + its query subscription (enables TTL/GC). */
  destroy?(): void;
};

/** Anything `useQuery` can subscribe to (a typed query or a named query). */
export interface Subscribable<T> {
  materialize(): ViewLike<T>;
}

/** What a [`TypedQuery`] needs from the client to materialize itself. */
export interface QueryHost {
  materialize(q: Query): ViewLike<Row>;
}

/**
 * A query bound to a row type `T` (from the schema) and to its client, mirroring
 * Zero's `z.query.<table>`. `where`/`orderBy` are checked against `T`'s columns,
 * and the materialized result is typed `T[]`. The `One` type parameter tracks
 * `.one()` so that when this query is used as a `related` child it types as a
 * single row (`R | undefined`) instead of an array (`R[]`).
 */
export class TypedQuery<T extends Row, One extends boolean = false> implements Subscribable<T> {
  readonly #host: QueryHost | null;
  readonly #q: Query;

  constructor(host: QueryHost | null, q: Query) {
    this.#host = host;
    this.#q = q;
  }

  where<K extends keyof T & string>(
    field: K,
    op: SimpleOperator,
    value: T[K] | readonly NonNullable<T[K]>[],
  ): TypedQuery<T, One> {
    return new TypedQuery<T, One>(this.#host, this.#q.where(field, op, value as Value));
  }

  whereExists(correlation: Correlation, subquery: TypedQuery<Row, boolean> | Query, negated = false): TypedQuery<T, One> {
    const sub = subquery instanceof TypedQuery ? subquery.query() : subquery;
    return new TypedQuery<T, One>(this.#host, this.#q.whereExists(correlation, sub, negated));
  }

  /**
   * Add a nested relationship. The result type gains `name`: a `R[]` array, or
   * `R | undefined` if the child query was `.one()`.
   */
  related<Name extends string, R extends Row, ROne extends boolean>(
    name: Name,
    correlation: Correlation,
    subquery: TypedQuery<R, ROne>,
  ): TypedQuery<T & { [K in Name]: ROne extends true ? R | undefined : R[] }, One> {
    return new TypedQuery(this.#host, this.#q.related(name, correlation, subquery.query()));
  }

  orderBy<K extends keyof T & string>(field: K, dir: Direction): TypedQuery<T, One> {
    return new TypedQuery<T, One>(this.#host, this.#q.orderBy(field, dir));
  }

  limit(n: number): TypedQuery<T, One> {
    return new TypedQuery<T, One>(this.#host, this.#q.limit(n));
  }

  one(): TypedQuery<T, true> {
    return new TypedQuery<T, true>(this.#host, this.#q.one());
  }

  start(row: Partial<T>, exclusive = false): TypedQuery<T, One> {
    return new TypedQuery<T, One>(this.#host, this.#q.start(row as Row, exclusive));
  }

  /** The underlying untyped query (escape hatch). */
  query(): Query {
    return this.#q;
  }

  ast(): AST {
    return this.#q.ast();
  }

  /** Materialize into a live, typed view. */
  materialize(): ViewLike<T> {
    if (!this.#host) throw new Error('this query is an unbound builder; subscribe via orbit.query.<name>()');
    return this.#host.materialize(this.#q) as ViewLike<T>;
  }
}

/**
 * Standalone, typed query builders for a schema (mirrors Zero's `createBuilder`).
 * Use inside query definitions: `builder.todo.where('id', '=', args.id)`. The
 * returned queries are unbound (used to produce ASTs, not subscribed directly).
 */
export function createBuilder<S extends SchemaDef>(
  schema: S,
): { [K in keyof S['tables']]: TypedQuery<RowOf<S['tables'][K]>> } {
  const out = {} as { [K in keyof S['tables']]: TypedQuery<RowOf<S['tables'][K]>> };
  for (const name of Object.keys(schema.tables)) {
    (out as Record<string, TypedQuery<Row>>)[name] = new TypedQuery<Row>(null, Query.from(name));
  }
  return out;
}
