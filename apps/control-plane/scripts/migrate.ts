import postgres from 'postgres'
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations')

const databaseUrl = process.env['DATABASE_URL']
if (!databaseUrl) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const sql = postgres(databaseUrl)

async function migrate() {
  // Ensure migration tracking table exists
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `

  // Read applied migrations
  const applied = await sql<{ filename: string }[]>`
    SELECT filename FROM _migrations ORDER BY filename
  `
  const appliedSet = new Set(applied.map(r => r.filename))

  // Read migration files
  const files = (await readdir(MIGRATIONS_DIR))
    .filter(f => f.endsWith('.sql'))
    .sort()

  let count = 0
  for (const file of files) {
    if (appliedSet.has(file)) continue

    const filePath = join(MIGRATIONS_DIR, file)
    const sqlContent = await readFile(filePath, 'utf8')

    console.log(`Applying migration: ${file}`)
    await sql.begin(async (tx) => {
      await tx.unsafe(sqlContent)
      await tx`INSERT INTO _migrations (filename) VALUES (${file})`
    })
    count++
  }

  if (count === 0) {
    console.log('All migrations already applied.')
  } else {
    console.log(`Applied ${count} migration(s).`)
  }

  await sql.end()
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
