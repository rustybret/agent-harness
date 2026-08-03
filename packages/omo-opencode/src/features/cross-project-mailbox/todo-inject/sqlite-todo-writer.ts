import { join } from "node:path"
import { getDataDir } from "../../../shared/data-path"
import { importBunSqlite } from "../../../shared/bun-sqlite-shim"
import type { TodoItem, TodoWriter } from "./todo-inject"

const DEFAULT_PRIORITY = "medium"

export function getDefaultTodoDatabasePath(): string {
  return join(getDataDir(), "opencode", "opencode.db")
}

export function createSqliteTodoWriter(databasePath = getDefaultTodoDatabasePath()): TodoWriter {
  return async ({ sessionID, todos }) => {
    const sqliteModule = await importBunSqlite()
    const Database = sqliteModule?.Database
    if (Database === undefined) {
      throw new Error("bun:sqlite is unavailable for todo injection")
    }
    const database = new Database(databasePath)
    try {
      const deleteTodos = database.prepare("DELETE FROM todo WHERE session_id = ?")
      const insertTodo = database.prepare(
        "INSERT INTO todo (session_id, content, status, priority, position, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      const writeTodos = database.transaction((nextTodos: readonly TodoItem[]) => {
        deleteTodos.run(sessionID)
        const now = Date.now()
        nextTodos.forEach((todo, index) => {
          insertTodo.run(sessionID, todo.content, todo.status, todo.priority ?? DEFAULT_PRIORITY, index, now, now)
        })
      })
      writeTodos(todos)
    } finally {
      database.close()
    }
  }
}
