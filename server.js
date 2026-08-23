const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./database');

const app = express();



// Konfigurasi Views & Static File untuk Railway (Linux)
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.set('view cache', false); // 👈 TAMBAHKAN DI SINI
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'sm_laundry_bangkalan_secret_key',
  resave: false,
  saveUninitialized: true
}));

// Middleware Otentikasi
function checkAuth(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/login');
}

function checkOwner(req, res, next) {
  if (req.session.user && req.session.user.role === 'owner') return next();
  res.status(403).send("Akses Ditolak: Khusus Owner");
}

// ------------------- PUBLIC LANDING PAGE -------------------
app.get('/', (req, res) => {
  db.all("SELECT * FROM services", (err, services) => {
    res.render('public', {
      info: {
        name: "SM Laundry",
        phone: "6285257357246",
        address: "Jalan Maritim 28 Socah Bangkalan"
      },
      services
    });
  });
});

// ------------------- LOGIN & LOGOUT -------------------
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
    if (user && await bcrypt.compare(password, user.password)) {
      req.session.user = user;
      return res.redirect('/dashboard');
    }
    res.render('login', { error: "Username atau Password salah!" });
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// ------------------- DASHBOARD / BERANDA -------------------
app.get('/dashboard', checkAuth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const filter = req.query.filter || '';
  const searchInvoice = req.query.search_invoice || '';

  const qTodayCount = "SELECT COUNT(*) as total FROM transactions WHERE DATE(date_entry) = ?";
  const qToFinish = "SELECT COUNT(*) as total FROM transactions WHERE DATE(date_finish) = ? AND status != 'Diambil'";
  const qLateCount = "SELECT COUNT(*) as total FROM transactions WHERE DATE(date_finish) < ? AND status NOT IN ('Selesai', 'Diambil')";
  const qOmsetToday = "SELECT SUM(total_amount) as total FROM transactions WHERE DATE(date_entry) = ? AND payment_status = 'Lunas'";
  
  let qList = "SELECT t.*, c.name as customer_name, c.phone FROM transactions t JOIN customers c ON t.customer_id = c.id WHERE 1=0";
  let params = [];

  if (filter === 'today') {
    qList = "SELECT t.*, c.name as customer_name, c.phone FROM transactions t JOIN customers c ON t.customer_id = c.id WHERE DATE(t.date_entry) = ? ORDER BY t.id DESC";
    params = [today];
  } else if (filter === 'to_finish') {
    qList = "SELECT t.*, c.name as customer_name, c.phone FROM transactions t JOIN customers c ON t.customer_id = c.id WHERE DATE(t.date_finish) = ? AND t.status != 'Diambil' ORDER BY t.id DESC";
    params = [today];
  } else if (filter === 'late') {
    qList = "SELECT t.*, c.name as customer_name, c.phone FROM transactions t JOIN customers c ON t.customer_id = c.id WHERE DATE(t.date_finish) < ? AND t.status NOT IN ('Selesai', 'Diambil') ORDER BY t.date_finish ASC";
    params = [today];
  } else if (searchInvoice) {
    qList = "SELECT t.*, c.name as customer_name, c.phone FROM transactions t JOIN customers c ON t.customer_id = c.id WHERE t.invoice_no LIKE ? ORDER BY t.id DESC";
    params = [`%${searchInvoice}%`];
  }

  db.get(qTodayCount, [today], (err, r1) => {
    db.get(qToFinish, [today], (err, r2) => {
      db.get(qLateCount, [today], (err, r3) => {
        db.get(qOmsetToday, [today], (err, r4) => {
          db.all(qList, params, (err, listResults) => {
            res.render('dashboard', {
              user: req.session.user,
              stats: {
                todayCount: r1 ? r1.total : 0,
                toFinishCount: r2 ? r2.total : 0,
                lateCount: r3 ? r3.total : 0,
                todayOmset: (r4 && r4.total) ? r4.total : 0
              },
              listResults: listResults || [],
              filter,
              searchInvoice
            });
          });
        });
      });
    });
  });
});

// ------------------- POS / KASIR BARU -------------------
app.get('/pos', checkAuth, (req, res) => {
  db.all("SELECT * FROM services", (err, services) => {
    db.all("SELECT * FROM parfums", (err, parfums) => {
      db.all("SELECT * FROM customers ORDER BY name ASC", (err, customers) => {
        res.render('pos', { services: services || [], parfums: parfums || [], customers: customers || [] });
      });
    });
  });
});

app.post('/pos', checkAuth, (req, res) => {
  const {
    customer_name, phone, items, parfum_id,
    date_finish, payment_method, payment_status,
    sop_daleman, sop_baju_putih, sop_isi_satuan, sop_mudah_rusak
  } = req.body;

  const today = new Date().toISOString().split('T')[0];
  const invoiceNo = 'INV-' + Date.now().toString().slice(-6);

  let selectedItems = [];
  try {
    selectedItems = typeof items === 'string' ? JSON.parse(items) : items;
  } catch (e) {
    selectedItems = [];
  }

  if (!selectedItems || selectedItems.length === 0) {
    return res.status(400).send("Pilih minimal satu layanan.");
  }

  const totalAmount = selectedItems.reduce((sum, item) => sum + (parseFloat(item.qty) * parseFloat(item.price)), 0);
  const totalWeight = selectedItems.reduce((sum, item) => sum + parseFloat(item.qty), 0);

  db.get("SELECT id FROM customers WHERE phone = ?", [phone], (err, customer) => {
    const saveTransaction = (cid) => {
      db.run(`INSERT INTO transactions 
        (invoice_no, customer_id, date_entry, date_finish, weight, parfum_id, 
         sop_daleman, sop_baju_putih, sop_isi_satuan, sop_mudah_rusak, 
         payment_method, payment_status, total_amount, status, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Proses', ?)`,
        [
          invoiceNo, cid, today, date_finish, totalWeight, parfum_id,
          sop_daleman ? 1 : 0, sop_baju_putih ? 1 : 0, sop_isi_satuan ? 1 : 0, sop_mudah_rusak ? 1 : 0,
          payment_method, payment_status, totalAmount, req.session.user.id
        ],
        function (err) {
          const transId = this.lastID;
          const stmt = db.prepare("INSERT INTO transaction_items (transaction_id, service_id, qty, subtotal) VALUES (?, ?, ?, ?)");
          selectedItems.forEach(item => {
            const subtotal = parseFloat(item.qty) * parseFloat(item.price);
            stmt.run(transId, item.id, item.qty, subtotal);
          });
          stmt.finalize(() => {
            res.redirect(`/nota/${transId}`);
          });
        }
      );
    };

    if (customer) {
      db.run("UPDATE customers SET name = ? WHERE id = ?", [customer_name, customer.id], () => {
        saveTransaction(customer.id);
      });
    } else {
      db.run("INSERT INTO customers (name, phone) VALUES (?, ?)", [customer_name, phone], function () {
        saveTransaction(this.lastID);
      });
    }
  });
});

// Halaman Nota
app.get('/nota/:id', checkAuth, (req, res) => {
  const query = `
    SELECT t.*, c.name as customer_name, c.phone, p.name as parfum_name, u.name as pegawai_name
    FROM transactions t
    JOIN customers c ON t.customer_id = c.id
    LEFT JOIN parfums p ON t.parfum_id = p.id
    LEFT JOIN users u ON t.user_id = u.id
    WHERE t.id = ?
  `;
  db.get(query, [req.params.id], (err, trans) => {
    if (!trans) return res.send("Transaksi tidak ditemukan");

    db.all(`SELECT ti.*, s.name as service_name, s.category, s.type_duration, s.price 
            FROM transaction_items ti 
            JOIN services s ON ti.service_id = s.id 
            WHERE ti.transaction_id = ?`, [trans.id], (err, items) => {

      const waText = encodeURIComponent(
        `Halo Kak *${trans.customer_name}*,\n` +
        `Terima kasih telah menggunakan jasa *SM Laundry*!\n\n` +
        `*Detail Nota:* ${trans.invoice_no}\n` +
        `Tgl Masuk: ${trans.date_entry}\n` +
        `Tgl Selesai: ${trans.date_finish}\n` +
        `Total: Rp ${trans.total_amount.toLocaleString('id-ID')}\n` +
        `Status Bayar: *${trans.payment_status}*\n\n` +
        `Alamat: Jl. Maritim 28 Socah Bangkalan\n` +
        `Info/Tanya: https://wa.me/6285257357246`
      );

      let formattedPhone = trans.phone.startsWith('0') ? '62' + trans.phone.slice(1) : trans.phone;
      const waUrl = `https://wa.me/${formattedPhone}?text=${waText}`;

      res.render('nota', { trans, items: items || [], waUrl });
    });
  });
});

// ------------------- MASTER DATA -------------------
app.get('/master', checkAuth, (req, res) => {
  db.all("SELECT * FROM customers", (err, customers) => {
    db.all("SELECT * FROM parfums", (err, parfums) => {
      db.all("SELECT * FROM services", (err, services) => {
        db.all("SELECT id, username, name, role FROM users", (err, users) => {
          const qTransactions = `
            SELECT t.*, c.name as customer_name 
            FROM transactions t 
            LEFT JOIN customers c ON t.customer_id = c.id 
            ORDER BY t.id DESC
          `;
          db.all(qTransactions, (err, transactions) => {
            res.render('master', { 
              customers: customers || [], 
              parfums: parfums || [], 
              services: services || [], 
              users: users || [], 
              transactions: transactions || [], 
              currentUser: req.session.user 
            });
          });
        });
      });
    });
  });
});

app.post('/master/parfum/add', checkAuth, (req, res) => {
  const { name } = req.body;
  if(name) {
    db.run("INSERT INTO parfums (name) VALUES (?)", [name], () => res.redirect('/master'));
  } else {
    res.redirect('/master');
  }
});

app.post('/master/service/add', checkAuth, checkOwner, (req, res) => {
  const { category, name, duration_value, duration_unit, price } = req.body;
  const type_duration = `${duration_value} ${duration_unit}`;
  db.run("INSERT INTO services (category, name, type_duration, price) VALUES (?, ?, ?, ?)", 
    [category, name, type_duration, price], () => res.redirect('/master'));
});

app.post('/master/user/add', checkAuth, checkOwner, async (req, res) => {
  const { username, password, name, role } = req.body;
  const hash = await bcrypt.hash(password, 10);
  db.run("INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)", 
    [username, hash, name, role], () => res.redirect('/master'));
});

app.get('/master/delete/:table/:id', checkAuth, checkOwner, (req, res) => {
  const { table, id } = req.params;
  const allowedTables = ['services', 'parfums', 'users', 'customers', 'transactions'];
  
  if (allowedTables.includes(table)) {
    if(table === 'transactions') {
      db.run("DELETE FROM transaction_items WHERE transaction_id = ?", [id], () => {
        db.run("DELETE FROM transactions WHERE id = ?", [id], () => res.redirect('/master'));
      });
    } else {
      db.run(`DELETE FROM ${table} WHERE id = ?`, [id], () => res.redirect('/master'));
    }
  } else {
    res.redirect('/master');
  }
});

// ------------------- FITUR EDIT & STATUS TRANSAKSI -------------------
app.get('/transaksi/status/:id', checkAuth, (req, res) => {
  const { id } = req.params;
  const status = req.query.status || 'Lunas';
  
  db.run('UPDATE transactions SET payment_status = ? WHERE id = ?', [status, id], (err) => {
    res.redirect('/master');
  });
});

app.get('/transaksi/delete/:id', checkAuth, (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM transaction_items WHERE transaction_id = ?', [id], () => {
    db.run('DELETE FROM transactions WHERE id = ?', [id], () => res.redirect('/master'));
  });
});

app.get('/transaksi/edit/:id', checkAuth, (req, res) => {
  const { id } = req.params;
  db.get('SELECT * FROM transactions WHERE id = ?', [id], (err, transaction) => {
    if (err || !transaction) {
      return res.status(404).send('Transaksi tidak ditemukan');
    }
    db.all('SELECT * FROM transaction_items WHERE transaction_id = ?', [id], (err, items) => {
      res.render('edit-transaksi', { transaction, items, currentUser: req.session.user });
    });
  });
});

app.post('/transaksi/edit/:id', checkAuth, (req, res) => {
  const { id } = req.params;
  const { payment_status, status } = req.body;
  
  db.run(
    'UPDATE transactions SET payment_status = ?, status = ? WHERE id = ?',
    [payment_status, status, id],
    (err) => {
      if (err) console.error(err);
      res.redirect('/master');
    }
  );
});

// ------------------- LAPORAN KEUANGAN -------------------
app.get('/laporan', checkAuth, checkOwner, (req, res) => {
  const today = new Date().toISOString().split('T')[0];

  const qHarian = "SELECT SUM(total_amount) as total FROM transactions WHERE DATE(date_entry) = ? AND payment_status = 'Lunas'";
  const qMingguan = "SELECT SUM(total_amount) as total FROM transactions WHERE date_entry >= date('now', '-7 days') AND payment_status = 'Lunas'";
  const qBulanan = "SELECT SUM(total_amount) as total FROM transactions WHERE strftime('%Y-%m', date_entry) = strftime('%Y-%m', 'now') AND payment_status = 'Lunas'";
  const qPiutang = "SELECT SUM(total_amount) as total FROM transactions WHERE payment_status = 'Belum Lunas'";
  const qDetailPiutang = "SELECT t.*, c.name as customer_name, c.phone FROM transactions t JOIN customers c ON t.customer_id = c.id WHERE t.payment_status = 'Belum Lunas'";

  db.get(qHarian, [today], (err, rHarian) => {
    db.get(qMingguan, (err, rMingguan) => {
      db.get(qBulanan, (err, rBulanan) => {
        db.get(qPiutang, (err, rPiutang) => {
          db.all(qDetailPiutang, (err, listPiutang) => {
            res.render('laporan', {
              harian: rHarian ? (rHarian.total || 0) : 0,
              mingguan: rMingguan ? (rMingguan.total || 0) : 0,
              bulanan: rBulanan ? (rBulanan.total || 0) : 0,
              piutang: rPiutang ? (rPiutang.total || 0) : 0,
              listPiutang: listPiutang || []
            });
          });
        });
      });
    });
  });
});

// ------------------- ROUTE TRACKING PUBLIK -------------------
app.get('/track', (req, res) => {
  const notaNo = req.query.nota;
  if (!notaNo) return res.render('track');

  db.get("SELECT * FROM transactions WHERE invoice_no = ?", [notaNo], (err, order) => {
    res.render('track', { order: order, notaNo: notaNo });
  });
});

app.get('/api/check-status/:notaNum', (req, res) => {
  const { notaNum } = req.params;
  const query = `
    SELECT t.invoice_no, t.date_finish, t.payment_status, t.status, c.name as customer_name
    FROM transactions t
    JOIN customers c ON t.customer_id = c.id
    WHERE t.invoice_no = ?
  `;

  db.get(query, [notaNum], (err, trans) => {
    if (err || !trans) return res.status(404).json({ message: 'Nota tidak ditemukan' });

    res.json({
      nota_number: trans.invoice_no,
      customer_name: trans.customer_name,
      date_finish: trans.date_finish,
      payment_status: trans.payment_status,
      status: trans.status
    });
  });
});

// ------------------- UPDATE USER / PEGAWAI -------------------
app.post('/master/user/edit/:id', checkAuth, async (req, res) => {
  if (req.session.user.role !== 'owner') return res.status(403).send('Akses Ditolak');

  const { id } = req.params;
  const { name, username, password, role } = req.body;

  try {
    // 1. Jika password diawali $2b$, artinya password lama terenkripsi (tidak diubah user)
    if (password.startsWith('$2b$')) {
      db.run("UPDATE users SET name = ?, username = ?, role = ? WHERE id = ?", 
        [name, username, role, id], (err) => {
          res.redirect('/master');
        }
      );
    } else {
      // 2. Jika password baru diisi teks biasa, HASH dulu dengan bcrypt
      const hash = await bcrypt.hash(password, 10);
      db.run("UPDATE users SET name = ?, username = ?, password = ?, role = ? WHERE id = ?", 
        [name, username, hash, role, id], (err) => {
          res.redirect('/master');
        }
      );
    }
  } catch (err) {
    console.error(err);
    res.redirect('/master');
  }
});

// ------------------- JALANKAN SERVER -------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server SM Laundry berjalan di http://localhost:${PORT}`);
});