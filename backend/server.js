const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const DB_DIR = path.join(__dirname, 'db');
const USERS_FILE = path.join(DB_DIR, 'users.json');
const PRODUCTS_FILE = path.join(DB_DIR, 'products.json');
const ORDERS_FILE = path.join(DB_DIR, 'orders.json');
const JWT_SECRET = process.env.JWT_SECRET || 'ujenzi-smart-secret';

const app = express();
app.use(express.json());
app.use(cors());

// Serve frontend files from project root
app.use(express.static(path.join(__dirname, '../')));

async function readJson(filePath, defaultValue = []) {
  try { const raw = await fs.readFile(filePath, 'utf8'); return JSON.parse(raw || '[]'); }
  catch (err) { if (err.code === 'ENOENT') return defaultValue; throw err; }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function ensureDefaultData() {
  const existingUsers = await readJson(USERS_FILE, null);
  if (!existingUsers || existingUsers.length === 0) {
    const adminPw = await bcrypt.hash('admin123', 10);
    await writeJson(USERS_FILE, [
      { id: uuidv4(), name: 'Admin', email: 'admin@ujenzi.co', password: adminPw, phone: '+255000000000', role: 'admin' }
    ]);
  }

  const existingProducts = await readJson(PRODUCTS_FILE, null);
  if (!existingProducts || existingProducts.length === 0) {
    await writeJson(PRODUCTS_FILE, [
      { id: uuidv4(), name: 'Cement 50kg', description: 'High strength portland cement', price: 26000, stock: 180, unit: 'bag', category: 'Concrete', imageUrl: 'https://via.placeholder.com/150' },
      { id: uuidv4(), name: 'Steel Rebars 10mm', description: 'Ribbed reinforcing bar', price: 9000, stock: 110, unit: 'piece', category: 'Steel', imageUrl: 'https://via.placeholder.com/150' },
      { id: uuidv4(), name: 'Sacks of Sand (m3)', description: 'Clean river sand', price: 35000, stock: 90, unit: 'm3', category: 'Aggregate', imageUrl: 'https://via.placeholder.com/150' }
    ]);
  }

  const existingOrders = await readJson(ORDERS_FILE, null);
  if (!existingOrders) await writeJson(ORDERS_FILE, []);
}

function createToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Missing authentication token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch (err) { return res.status(401).json({ error: 'Invalid or expired token' }); }
}

app.get('/api/auth/check-email', async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email query parameter required' });
  const users = await readJson(USERS_FILE, []);
  const user = users.find(u => u.email.toLowerCase() === email);
  res.json({ exists: Boolean(user), isAdmin: user?.role === 'admin', email });
});

app.post('/api/auth/register', async (req, res) => {
  const { name = '', email = '', password = '', phone = '' } = req.body;
  if (!name || !email || !password || !phone) return res.status(400).json({ error: 'Missing registration fields' });
  const normalized = email.toLowerCase();
  const users = await readJson(USERS_FILE, []);
  if (users.some(u => u.email.toLowerCase() === normalized)) return res.status(409).json({ error: 'Email already in use' });

  const hashed = await bcrypt.hash(password, 10);
  const newUser = { id: uuidv4(), name, email: normalized, password: hashed, phone, role: 'customer', createdAt: new Date().toISOString() };
  users.push(newUser);
  await writeJson(USERS_FILE, users);

  const token = createToken(newUser);
  res.json({ user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role, phone: newUser.phone }, token });
});

app.post('/api/auth/login', async (req, res) => {
  const { email = '', password = '' } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const users = await readJson(USERS_FILE, []);
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const passOk = await bcrypt.compare(password, user.password);
  if (!passOk) return res.status(401).json({ error: 'Invalid email or password' });

  const token = createToken(user);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone }, token });
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const users = await readJson(USERS_FILE, []);
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone } });
});

app.get('/api/products', async (req, res) => {
  const products = await readJson(PRODUCTS_FILE, []);
  res.json(products);
});

app.post('/api/products', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const { name, description, price, stock, unit, category, imageUrl } = req.body;
  if (!name || !price || stock === undefined) return res.status(400).json({ error: 'Missing product fields' });

  const products = await readJson(PRODUCTS_FILE, []);
  const newProduct = { id: uuidv4(), name, description: description || '', price: Number(price), stock: Number(stock), unit: unit || 'unit', category: category || 'general', imageUrl: imageUrl || 'https://via.placeholder.com/150', createdAt: new Date().toISOString() };
  products.push(newProduct);
  await writeJson(PRODUCTS_FILE, products);
  res.status(201).json(newProduct);
});

app.post('/api/orders', authMiddleware, async (req, res) => {
  const { items, deliveryAddress, paymentMethod, total } = req.body;
  if (!Array.isArray(items) || !items.length || !deliveryAddress || !paymentMethod || !total) {
    return res.status(400).json({ error: 'Missing order data' });
  }

  const orders = await readJson(ORDERS_FILE, []);
  const products = await readJson(PRODUCTS_FILE, []);

  // Deduct stock for each item
  const updatedProducts = products.map(product => {
    const orderItem = items.find(i => i.id === product.id);
    if (!orderItem) return product;

    const newStock = product.stock - orderItem.quantity;
    if (newStock < 0) throw new Error(`Insufficient stock for ${product.name}`);
    return { ...product, stock: newStock };
  });
  await writeJson(PRODUCTS_FILE, updatedProducts);

  const order = {
    id: uuidv4(),
    userId: req.user.id,
    items,
    deliveryAddress,
    paymentMethod,
    total,
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };
  orders.push(order);
  await writeJson(ORDERS_FILE, orders);
  res.status(201).json(order);
});

app.get('/api/orders', authMiddleware, async (req, res) => {
  const orders = await readJson(ORDERS_FILE, []);
  if (req.user.role === 'admin') return res.json(orders);
  res.json(orders.filter(o => o.userId === req.user.id));
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

(async () => {
  await ensureDefaultData();
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`UjenziSmart backend running on http://localhost:${PORT}`);
    console.log('Frontend is served from project root (login.html etc.)');
  });
})();
