import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

export type SqliteResult<T = Record<string, unknown>> = {
  success: true;
  results?: T[];
  meta?: {
    changes?: number | bigint;
    lastRowId?: number | bigint;
  };
};

export interface SqliteStatement {
  bind: (...values: unknown[]) => SqliteStatement;
  run: <T = Record<string, unknown>>() => Promise<SqliteResult<T>>;
  all: <T = Record<string, unknown>>() => Promise<SqliteResult<T>>;
  first: <T = Record<string, unknown>>(column?: string) => Promise<T | null>;
}

export interface SqliteDatabase {
  prepare: (query: string) => SqliteStatement;
  batch: <T = Record<string, unknown>>(statements: SqliteStatement[]) => Promise<SqliteResult<T>[]>;
}

function inputValues(values: unknown[]): SQLInputValue[] {
  return values.map((value) => {
    if (value === undefined) return null;
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "bigint" ||
      value instanceof Uint8Array
    ) {
      return value;
    }
    throw new TypeError(`Unsupported SQLite parameter type: ${typeof value}`);
  });
}

class LocalStatement implements SqliteStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new LocalStatement(this.database, this.query, values);
  }

  private nativeStatement(): StatementSync {
    return this.database.prepare(this.query);
  }

  runSync<T = Record<string, unknown>>(): SqliteResult<T> {
    const result = this.nativeStatement().run(...inputValues(this.values));
    return {
      success: true,
      meta: {
        changes: result.changes,
        lastRowId: result.lastInsertRowid,
      },
    };
  }

  async run<T = Record<string, unknown>>() {
    return this.runSync<T>();
  }

  async all<T = Record<string, unknown>>() {
    const results = this.nativeStatement().all(...inputValues(this.values)) as T[];
    return { success: true as const, results };
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.nativeStatement().get(...inputValues(this.values)) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (column) return (row[column] ?? null) as T | null;
    return row as T;
  }
}

class LocalDatabase implements SqliteDatabase {
  constructor(private readonly database: DatabaseSync) {}

  prepare(query: string) {
    return new LocalStatement(this.database, query);
  }

  async batch<T = Record<string, unknown>>(statements: SqliteStatement[]) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => {
        if (!(statement instanceof LocalStatement)) {
          throw new TypeError("SQLite batch received a statement from another database adapter");
        }
        return statement.runSync<T>();
      });
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

type ConnectionHolder = {
  path: string;
  native: DatabaseSync;
  adapter: LocalDatabase;
};

const globalConnections = globalThis as typeof globalThis & {
  __writerStudioSqlite?: ConnectionHolder;
};

export function databasePath() {
  const configured = process.env.WRITER_STUDIO_DB_PATH?.trim();
  const resolvedPath = path.resolve(process.cwd(), configured || path.join("data", "writer-studio.sqlite"));
  if (process.env.WRITER_STUDIO_TEST_MODE === "1") {
    const testDataDirectory = path.resolve(process.cwd(), ".test-data");
    const relativePath = path.relative(testDataDirectory, resolvedPath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error(`Test mode refuses to open a database outside .test-data: ${resolvedPath}`);
    }
  }
  return resolvedPath;
}

export function getDatabase(): SqliteDatabase {
  const resolvedPath = databasePath();
  const existing = globalConnections.__writerStudioSqlite;
  if (existing?.path === resolvedPath) return existing.adapter;

  if (existing) existing.native.close();
  mkdirSync(path.dirname(resolvedPath), { recursive: true });

  const native = new DatabaseSync(resolvedPath);
  native.exec("PRAGMA foreign_keys = ON");
  native.exec("PRAGMA journal_mode = WAL");
  native.exec("PRAGMA synchronous = NORMAL");
  native.exec("PRAGMA busy_timeout = 5000");

  const adapter = new LocalDatabase(native);
  globalConnections.__writerStudioSqlite = { path: resolvedPath, native, adapter };
  return adapter;
}
