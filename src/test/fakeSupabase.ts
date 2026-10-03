// An in-memory Supabase client for tests: the three v20 tables with own-row
// RLS (rows of other users are invisible and cannot be written), the query
// shapes the data source uses (match, order, range, limit, maybeSingle,
// upsert with onConflict, delete with match) and the two RPCs with their real
// semantics as supabase/v20/migrations/0001_init.sql defines them: save_day
// refuses to write when the row changed since the caller's base (a null
// base overwrites), patch_settings deep-merges (objects recurse, arrays and
// scalars replace, JSON null deletes) and fails without a profiles row. As
// on the server, the signed-in user's profiles row exists from the start
// (sign-up creates it). Every write stamps a distinct updated_at from a
// ticking clock, one stamp per call. Inputs are JSON round-tripped like a
// wire call, so `undefined` keys vanish and callers' objects are never
// aliased. `tables` and `calls` are open for assertions.

import type { DbClient, DbError, DbResult, DeleteQuery, Row, SelectQuery, TableName, TableQuery } from "../data/supabaseTypes";

export interface FakeSupabaseOptions {
  /** The signed-in user every query is scoped to. */
  userId: string;
  /** Consulted before each operation (e.g. "entries.select", "rpc.save_day"); a DbError makes that call fail. */
  failNext?: (op: string) => DbError | null | undefined;
  /** First clock value; each write advances it by one second. */
  startAt?: string;
}

export interface FakeCall {
  op: string;
  args: unknown;
}

export interface FakeSupabase extends DbClient {
  readonly userId: string;
  tables: Record<TableName, Row[]>;
  /** Every operation in order, for spying. */
  calls: FakeCall[];
  /** Replaceable after creation; see FakeSupabaseOptions.failNext. */
  failNext: (op: string) => DbError | null | undefined;
  /** The clock without advancing it. */
  now(): string;
  /** Advance the clock by one second and return the new stamp. */
  tick(): string;
}

export const RLS_MESSAGE = "new row violates row-level security policy";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const wire = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const ok = <T>(data: T): DbResult<T> => ({ data, error: null });
const fail = <T>(message: string, code?: string): DbResult<T> => ({ data: null, error: code === undefined ? { message } : { message, code } });

const PRIMARY_KEY: Record<TableName, readonly string[]> = { entries: ["user_id", "entry_date"], program: ["user_id"], profiles: ["id"] };
const OWNER_COLUMN: Record<TableName, string> = { entries: "user_id", program: "user_id", profiles: "id" };

/** patch_settings on the server: objects recurse, arrays and scalars replace, null deletes. */
export function jsonbDeepMerge(target: unknown, patch: unknown): Obj {
  const out: Obj = isObj(target) ? { ...target } : {};
  if (!isObj(patch)) return out;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    // Recurses even when the target has no object there, so nested nulls are stripped (as the server does).
    else if (isObj(value)) out[key] = jsonbDeepMerge(out[key], value);
    else out[key] = value;
  }
  return out;
}

interface SelectState {
  filters: [string, unknown][];
  order?: { column: string; ascending: boolean };
  range?: [number, number];
  limit?: number;
}

type Run = (state: SelectState) => Promise<DbResult<Row[]>>;

class FakeSelect implements SelectQuery<Row> {
  constructor(private readonly run: Run, private readonly state: SelectState) {}

  match(query: Record<string, unknown>): SelectQuery<Row> {
    return new FakeSelect(this.run, { ...this.state, filters: [...this.state.filters, ...Object.entries(query)] });
  }

  order(column: string, options?: { ascending?: boolean }): SelectQuery<Row> {
    return new FakeSelect(this.run, { ...this.state, order: { column, ascending: options?.ascending ?? true } });
  }

  range(from: number, to: number): SelectQuery<Row> {
    return new FakeSelect(this.run, { ...this.state, range: [from, to] });
  }

  limit(count: number): SelectQuery<Row> {
    return new FakeSelect(this.run, { ...this.state, limit: count });
  }

  maybeSingle(): PromiseLike<DbResult<Row | null>> {
    return this.run(this.state).then((result) => {
      if (result.error || result.data === null) return { data: null, error: result.error };
      if (result.data.length > 1) return fail<Row | null>("JSON object requested, multiple (or no) rows returned", "PGRST116");
      return ok(result.data[0] ?? null);
    });
  }

  then<R1 = DbResult<Row[]>, R2 = never>(
    onfulfilled?: ((value: DbResult<Row[]>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.run(this.state).then(onfulfilled, onrejected);
  }
}

class FakeDelete implements DeleteQuery {
  constructor(private readonly run: (filters: [string, unknown][]) => Promise<DbResult<unknown>>, private readonly filters: [string, unknown][]) {}

  match(query: Record<string, unknown>): DeleteQuery {
    return new FakeDelete(this.run, [...this.filters, ...Object.entries(query)]);
  }

  then<R1 = DbResult<unknown>, R2 = never>(
    onfulfilled?: ((value: DbResult<unknown>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.run(this.filters).then(onfulfilled, onrejected);
  }
}

const matches = (row: Row, filters: [string, unknown][]): boolean => filters.every(([column, value]) => row[column] === value);

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function project(row: Row, columns: string | undefined): Row {
  if (!columns || columns.trim() === "*") return { ...row };
  const out: Row = {};
  for (const column of columns.split(",").map((c) => c.trim()).filter(Boolean)) out[column] = row[column];
  return out;
}

export function createFakeSupabase(options: FakeSupabaseOptions): FakeSupabase {
  const { userId } = options;
  const calls: FakeCall[] = [];
  let clockMs = Date.parse(options.startAt ?? "2026-10-03T12:00:00.000Z");
  const now = (): string => new Date(clockMs).toISOString();
  const tick = (): string => {
    clockMs += 1000;
    return now();
  };
  const tables: Record<TableName, Row[]> = { entries: [], program: [], profiles: [{ id: userId, username: userId, settings: {}, updated_at: now() }] };

  const fake: FakeSupabase = {
    userId,
    tables,
    calls,
    failNext: options.failNext ?? (() => null),
    now,
    tick,
    from: (table) => tableQueries[table],
    rpc: (fn, args) => perform(`rpc.${fn}`, args, async () => callRpc(fn, wire(args ?? {}))),
  };

  /** Records the call and either fails it (failNext) or runs it. */
  async function perform<T>(op: string, args: unknown, run: () => Promise<DbResult<T>>): Promise<DbResult<T>> {
    calls.push({ op, args });
    const error = fake.failNext(op);
    return error ? { data: null, error } : run();
  }

  const visible = (table: TableName): Row[] => tables[table].filter((row) => row[OWNER_COLUMN[table]] === userId);

  function select(table: TableName, columns: string | undefined, state: SelectState): DbResult<Row[]> {
    let rows = visible(table).filter((row) => matches(row, state.filters));
    const { order, range, limit } = state;
    if (order) rows = [...rows].sort((a, b) => (order.ascending ? 1 : -1) * compare(a[order.column], b[order.column]));
    if (range) rows = rows.slice(range[0], range[1] + 1);
    if (limit !== undefined) rows = rows.slice(0, limit);
    return ok(rows.map((row) => project(row, columns)));
  }

  function upsert(table: TableName, rows: unknown, onConflict: string | undefined): DbResult<unknown> {
    const keys = onConflict ? onConflict.split(",").map((k) => k.trim()) : PRIMARY_KEY[table];
    const list = Array.isArray(rows) ? rows : [rows];
    const stamp = tick(); // now() is the transaction start: every row of one call gets the same stamp
    for (const raw of list) {
      if (!isObj(raw)) return fail("invalid row");
      if (raw[OWNER_COLUMN[table]] !== userId) return fail(RLS_MESSAGE, "42501");
      const store = tables[table];
      const index = store.findIndex((row) => keys.every((k) => row[k] === raw[k]));
      const next: Row = { ...(index >= 0 ? store[index] : {}), ...raw, updated_at: stamp };
      if (index >= 0) store[index] = next;
      else store.push(next);
    }
    return ok(null);
  }

  function remove(table: TableName, filters: [string, unknown][]): DbResult<unknown> {
    const owner = OWNER_COLUMN[table];
    tables[table] = tables[table].filter((row) => !(row[owner] === userId && matches(row, filters)));
    return ok(null);
  }

  const tableQueries: Record<TableName, TableQuery> = {
    entries: tableQuery("entries"),
    program: tableQuery("program"),
    profiles: tableQuery("profiles"),
  };

  function tableQuery(table: TableName): TableQuery {
    return {
      select: (columns) => new FakeSelect((state) => perform(`${table}.select`, { columns, ...state }, async () => select(table, columns, state)), { filters: [] }),
      upsert: (rows, opts) => perform(`${table}.upsert`, rows, async () => upsert(table, wire(rows), opts?.onConflict)),
      delete: () => new FakeDelete((filters) => perform(`${table}.delete`, filters, async () => remove(table, filters)), []),
    };
  }

  /** A null base overwrites; otherwise the row must not have moved past the base (1 ms slack, as on the server). */
  function saveDay(args: Obj): DbResult<unknown> {
    const { p_date, p_payload, p_base } = args;
    if (typeof p_date !== "string") return fail("BAD_DATE: save_day requires a date", "P0001");
    if (!isObj(p_payload)) return fail("BAD_PAYLOAD: save_day expects a JSON object", "P0001");
    const index = tables.entries.findIndex((row) => row.user_id === userId && row.entry_date === p_date);
    const existing = tables.entries[index];
    if (existing && typeof p_base === "string" && Date.parse(String(existing.updated_at)) > Date.parse(p_base) + 1) {
      return ok({ status: "conflict", payload: existing.payload, updated_at: existing.updated_at });
    }
    const row: Row = { user_id: userId, entry_date: p_date, payload: p_payload, updated_at: tick() };
    if (existing) tables.entries[index] = row;
    else tables.entries.push(row);
    return ok({ status: "ok", payload: row.payload, updated_at: row.updated_at });
  }

  function patchSettings(args: Obj): DbResult<unknown> {
    if (!isObj(args.patch)) return fail("BAD_PATCH: patch_settings expects a JSON object", "P0001");
    const index = tables.profiles.findIndex((row) => row.id === userId);
    const profile = tables.profiles[index];
    if (!profile) return fail("NO_PROFILE: no profiles row for the signed-in user", "P0001");
    const next: Row = { ...profile, settings: jsonbDeepMerge(profile.settings, args.patch), updated_at: tick() };
    tables.profiles[index] = next;
    return ok(next.settings);
  }

  function callRpc(fn: string, args: Obj): DbResult<unknown> {
    if (fn === "save_day") return saveDay(args);
    if (fn === "patch_settings") return patchSettings(args);
    return fail(`Could not find the function public.${fn} in the schema cache`, "PGRST202");
  }

  return fake;
}
