const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Base de datos en archivo
const dbPath = path.join(__dirname, 'database.sqlite');

const db = new sqlite3.Database(dbPath, err => {
  if (err) {
    console.error('❌ Error al conectar DB:', err.message);
  } else {
    console.log('📦 Base de datos SQLite conectada');
  }
});

// Crear tabla turnos si no existe
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS turnos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barber_id INTEGER,
      cliente TEXT,
      servicio TEXT,
      fecha TEXT,
      hora TEXT,
      origen TEXT,
      estado TEXT DEFAULT 'activo',
      recordatorioEnviado INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

module.exports = db;
