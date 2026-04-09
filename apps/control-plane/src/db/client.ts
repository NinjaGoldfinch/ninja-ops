import postgres from 'postgres'
import { config } from '../config.js'

export const sql = postgres(config.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
})

export async function closeDb(): Promise<void> {
  await sql.end()
}
