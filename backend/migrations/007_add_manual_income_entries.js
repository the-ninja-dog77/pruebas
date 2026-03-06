module.exports.up = function (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS manual_income_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barber_id INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      hora TEXT NOT NULL,
      monto INTEGER NOT NULL,
      concepto TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_manual_income_barber_fecha
      ON manual_income_entries (barber_id, fecha);
  `);
};

