// Type-safe schema builder, mirroring Zero's `createSchema` / `table().columns()
// .primaryKey()`. Defines tables + columns once and drives end-to-end TypeScript
// types: typed queries, typed query results, and typed mutators.

export type ValueType = 'string' | 'number' | 'boolean' | 'json' | 'null';

/** A column definition. The TS type it produces is carried in the `_type` phantom. */
export type Column<T = unknown> = {
  readonly type: ValueType;
  readonly optional: boolean;
  /** Phantom — never present at runtime; carries the column's TS type. */
  readonly _type?: T;
};

export const string = (): Column<string> => ({ type: 'string', optional: false });
export const number = (): Column<number> => ({ type: 'number', optional: false });
export const boolean = (): Column<boolean> => ({ type: 'boolean', optional: false });
export const json = <T = unknown>(): Column<T> => ({ type: 'json', optional: false });

/** Mark a column nullable (its TS type gains `| null`). */
export const optional = <T>(c: Column<T>): Column<T | null> => ({ ...c, optional: true });

export type Columns = Record<string, Column>;

export type TableDef<
  Name extends string = string,
  C extends Columns = Columns,
  PK extends keyof C & string = keyof C & string,
> = {
  readonly name: Name;
  readonly columns: C;
  readonly primaryKey: readonly PK[];
};

/** `table('todo').columns({ ... }).primaryKey('id')` */
export function table<Name extends string>(name: Name) {
  return {
    columns<C extends Columns>(columns: C) {
      return {
        primaryKey<PK extends keyof C & string>(...primaryKey: PK[]): TableDef<Name, C, PK> {
          return { name, columns, primaryKey };
        },
      };
    },
  };
}

export type SchemaDef<T extends Record<string, TableDef> = Record<string, TableDef>> = {
  readonly tables: T;
};

/** Combine table defs into a schema keyed by table name. */
export function createSchema<const T extends readonly TableDef[]>(def: {
  tables: T;
}): SchemaDef<{ [K in T[number] as K['name']]: K }> {
  const tables = {} as Record<string, TableDef>;
  for (const t of def.tables) tables[t.name] = t;
  return { tables } as SchemaDef<{ [K in T[number] as K['name']]: K }>;
}

// --- type inference ---------------------------------------------------------

/** The row type of a table def (column name -> TS value type). */
export type RowOf<T extends TableDef> = {
  [K in keyof T['columns']]: T['columns'][K] extends Column<infer V> ? V : never;
};

/** The primary-key column names of a table def. */
export type PkOf<T extends TableDef> = T['primaryKey'][number];

/** A permissive schema, used when no schema is supplied (everything is loose). */
export type AnySchema = SchemaDef<Record<string, TableDef>>;
