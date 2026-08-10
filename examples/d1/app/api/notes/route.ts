import { getDb } from "../../../../../db";

function toRouteErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const detail =
    error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  const combined = `${message}\n${detail}`;

  if (combined.includes("no such table") || combined.includes('from "notes"')) {
    return "The notes table is unavailable in the local SQLite database.";
  }

  return message;
}

export async function GET() {
  try {
    const db = getDb();
    await db.prepare("CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
    const result = await db.prepare("SELECT id,title,content,created_at AS createdAt FROM notes ORDER BY created_at DESC,id DESC LIMIT 20").all();

    return Response.json({ notes: result.results ?? [] });
  } catch (error) {
    return Response.json(
      { error: toRouteErrorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      title?: string;
      content?: string;
    };
    const title = payload.title?.trim() ?? "";
    const content = payload.content?.trim() ?? "";

    if (!title) {
      return Response.json({ error: "title is required" }, { status: 400 });
    }

    const db = getDb();
    await db.prepare("CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
    await db.prepare("INSERT INTO notes(title,content) VALUES(?,?)").bind(title, content).run();
    const note = await db.prepare("SELECT id,title,content,created_at AS createdAt FROM notes WHERE id=last_insert_rowid()").first();
    return Response.json({ note }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: toRouteErrorMessage(error) },
      { status: 500 }
    );
  }
}
