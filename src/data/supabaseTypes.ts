// The slice of the Supabase client the signed-in data source talks to, as
// structural types. The source and its tests never import supabase-js: the
// real client (supabase-js v2, `createClient(url, key)` with no Database
// generic) is assignable to DbClient as it is, because the method names and
// shapes here are those of postgrest-js (supabaseSource.test.ts checks that
// at compile time), and the in-memory fake in src/test implements the same
// interface. Results are the postgrest `{ data, error }` pairs; a query is a
// thenable, so `await` works on it directly.
//
// Filters use `match` (a set of equalities) rather than `eq`: they mean the
// same, but postgrest-js types `eq`'s column with a conditional type that
// TypeScript cannot relate structurally, while `match` has a plain overload.
// Rows and RPC results are deliberately untyped (`Row`, `unknown`): the
// source validates what comes off the wire itself.

export interface DbError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

export interface DbResult<T> {
  data: T | null;
  error: DbError | null;
}

/** One row as postgrest returns it: the selected columns, values unknown. */
export type Row = Record<string, unknown>;

export type TableName = "entries" | "program" | "profiles";

/** A select that is still being filtered and shaped; awaiting it runs it. */
export interface SelectQuery<T = Row> extends PromiseLike<DbResult<T[]>> {
  /** Keep rows whose columns equal the given values (AND). */
  match(query: Record<string, unknown>): SelectQuery<T>;
  order(column: string, options?: { ascending?: boolean }): SelectQuery<T>;
  /** Inclusive zero-based row window (offset/limit). */
  range(from: number, to: number): SelectQuery<T>;
  limit(count: number): SelectQuery<T>;
  /** Zero or one row; more than one is an error. */
  maybeSingle(): PromiseLike<DbResult<T | null>>;
}

/** A delete that is still being filtered; awaiting it runs it. */
export interface DeleteQuery extends PromiseLike<DbResult<unknown>> {
  match(query: Record<string, unknown>): DeleteQuery;
}

export interface TableQuery {
  select(columns?: string): SelectQuery<Row>;
  /** One row or a list; `onConflict` names the unique columns ("a,b"). */
  upsert(rows: unknown, options?: { onConflict?: string }): PromiseLike<DbResult<unknown>>;
  delete(): DeleteQuery;
}

export interface DbClient {
  from(table: TableName): TableQuery;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult<unknown>>;
}
