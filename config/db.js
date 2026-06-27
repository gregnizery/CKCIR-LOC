const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const useSsl = process.env.NODE_ENV === 'production' || /sslmode=require/.test(process.env.DATABASE_URL || '');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

async function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
}

module.exports = { pool, initSchema };
