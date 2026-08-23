const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const db = new sqlite3.Database('./smlaundry.db');

db.serialize(() => {
  // Tabel Pengguna (Owner / Pegawai)
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    name TEXT,
    role TEXT -- 'owner' atau 'pegawai'
  )`);

  // Tabel Layanan
  db.run(`CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT, -- Kiloan, Satuan, Dry Clean, dll.
    name TEXT,
    type_duration TEXT, -- Reguler (2 Hari), Kilat (1 Hari), Express (6 Jam)
    price REAL
  )`);

  // Tabel Parfum
  db.run(`CREATE TABLE IF NOT EXISTS parfums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT
  )`);

  // Tabel Pelanggan
  db.run(`CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    phone TEXT UNIQUE
  )`);

  // Tabel Transaksi
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no TEXT UNIQUE,
    customer_id INTEGER,
    date_entry TEXT,
    date_finish TEXT,
    weight REAL,
    parfum_id INTEGER,
    sop_daleman INTEGER,
    sop_baju_putih INTEGER,
    sop_isi_satuan INTEGER,
    sop_mudah_rusak INTEGER,
    payment_method TEXT,
    payment_status TEXT, -- 'Lunas' / 'Belum Lunas'
    total_amount REAL,
    status TEXT, -- 'Proses', 'Selesai', 'Diambil'
    user_id INTEGER,
    FOREIGN KEY(customer_id) REFERENCES customers(id)
  )`);

  // Tabel Item Transaksi (Layanan yang dipilih)
  db.run(`CREATE TABLE IF NOT EXISTS transaction_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER,
    service_id INTEGER,
    qty REAL,
    subtotal REAL
  )`);

  // Menambahkan Akun Default Admin/Owner & Data Awal jika belum ada
  db.get("SELECT * FROM users WHERE username = 'owner'", async (err, row) => {
    if (!row) {
      const hash = await bcrypt.hash('admin123', 10);
      db.run("INSERT INTO users (username, password, name, role) VALUES ('owner', ?, 'Owner SM Laundry', 'owner')", [hash]);
      db.run("INSERT INTO users (username, password, name, role) VALUES ('kasir1', ?, 'Pegawai Kasir', 'pegawai')", [hash]);
    }
  });

  db.get("SELECT COUNT(*) as count FROM services", (err, row) => {
    if (row && row.count === 0) {
      db.run("INSERT INTO services (category, name, type_duration, price) VALUES ('Kiloan', 'Cuci Komplit', 'Reguler (2 Hari)', 6000)");
      db.run("INSERT INTO services (category, name, type_duration, price) VALUES ('Kiloan', 'Cuci Komplit Express', 'Express (1 Hari)', 9000)");
      db.run("INSERT INTO services (category, name, type_duration, price) VALUES ('Satuan', 'Selimut Besar', 'Reguler (2 Hari)', 15000)");
      db.run("INSERT INTO parfums (name) VALUES ('Lavender'), ('Lily'), ('Snappy'), ('Akasia')");
    }
  });
});

module.exports = db;