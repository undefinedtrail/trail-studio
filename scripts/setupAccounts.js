require('dotenv').config();
const mongoose = require('mongoose');
const {
  connectDB,
  seedDefaults,
  User,
  Painting,
  Order,
  Booking,
  PotteryRequest,
  normalizeDate,
} = require('../models/db');

async function setupAccounts() {
  console.log('--- Trail Studio Account Initialization ---');

  // Connect to the configured MongoDB database
  await connectDB();

  // Ensure default paintings are seeded from seed.json if database is fresh
  await seedDefaults();

  // Target initial accounts (values can be supplied via environment variables)
  const customerEmail = (process.env.INITIAL_CUSTOMER_EMAIL || 'user@gmail.com').trim().toLowerCase();
  const customerPassword = process.env.INITIAL_CUSTOMER_PASSWORD || 'user123';

  const adminEmail = (process.env.INITIAL_ADMIN_EMAIL || 'admin@gmail.com').trim().toLowerCase();
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'admin123';

  // 1. Setup Customer Account (Idempotent - preserves existing password)
  let customer = await User.findOne({ email: customerEmail });
  if (!customer) {
    customer = new User({
      email: customerEmail,
      password: customerPassword, // Automatically hashed via pre-save hook
      role: 'customer',
    });
    await customer.save();
    console.log(`[Setup] Created customer account: ${customerEmail}`);
  } else {
    console.log(`[Setup] Customer account already exists: ${customerEmail} (Preserving existing data & password)`);
  }

  // 2. Setup Administrator Account (Idempotent - preserves existing password)
  let admin = await User.findOne({ email: adminEmail });
  if (!admin) {
    admin = new User({
      email: adminEmail,
      password: adminPassword, // Automatically hashed via pre-save hook
      role: 'admin',
    });
    await admin.save();
    console.log(`[Setup] Created administrator account: ${adminEmail}`);
  } else {
    console.log(`[Setup] Administrator account already exists: ${adminEmail} (Preserving existing data & password)`);
    if (admin.role !== 'admin') {
      admin.role = 'admin';
      await admin.save();
      console.log(`[Setup] Assigned 'admin' role to ${adminEmail}`);
    }
  }

  // 3. Ensure initial demonstration activity exists for the customer (Idempotent)
  const orderCount = await Order.countDocuments({ customerId: customer._id });
  if (orderCount === 0) {
    const p4 = await Painting.findOne({ code: 'p-004' });
    const p9 = await Painting.findOne({ code: 'p-009' });
    if (p4) {
      await Order.create({
        paintingId: p4._id,
        customerId: customer._id,
        status: 'placed',
      });
      p4.isAvailable = false;
      await p4.save();
    }
    if (p9) {
      await Order.create({
        paintingId: p9._id,
        customerId: customer._id,
        status: 'placed',
      });
      p9.isAvailable = false;
      await p9.save();
    }
    console.log('[Setup] Seeded initial customer painting orders (p-004, p-009).');
  }

  const bookingCount = await Booking.countDocuments({ customerId: customer._id });
  if (bookingCount === 0) {
    const d1 = normalizeDate(new Date(Date.now() + 14 * 86400000));
    const d2 = normalizeDate(new Date(Date.now() + 28 * 86400000));
    await Booking.create({
      customerId: customer._id,
      date: d1,
      size: 120,
      price: 120 * 150,
      address: '42 Lake Palace Road, Udaipur',
      status: 'confirmed',
    });
    await Booking.create({
      customerId: customer._id,
      date: d2,
      size: 180,
      price: 180 * 150,
      address: '15 Civil Lines, Jaipur',
      status: 'requested',
    });
    console.log('[Setup] Seeded initial customer mural bookings.');
  }

  const potteryCount = await PotteryRequest.countDocuments({ customerId: customer._id });
  if (potteryCount === 0) {
    const pD1 = normalizeDate(new Date(Date.now() + 18 * 86400000));
    const pD2 = normalizeDate(new Date(Date.now() + 25 * 86400000));
    const pD3 = normalizeDate(new Date(Date.now() + 30 * 86400000));
    await PotteryRequest.create({
      customerId: customer._id,
      itemId: 'i-01',
      glazeId: 'g-01',
      quantity: 6,
      neededBy: pD1,
      status: 'requested',
    });
    await PotteryRequest.create({
      customerId: customer._id,
      itemId: 'i-03',
      glazeId: 'g-03',
      quantity: 2,
      neededBy: pD2,
      status: 'accepted',
    });
    await PotteryRequest.create({
      customerId: customer._id,
      itemId: 'i-02',
      glazeId: 'g-04',
      quantity: 1,
      neededBy: pD3,
      status: 'requested',
    });
    console.log('[Setup] Seeded initial customer pottery requests.');
  }

  console.log('\n================================================================================');
  console.log(' Trail Studio Accounts Ready');
  console.log(' Customer:      ' + customerEmail);
  console.log(' Administrator: ' + adminEmail);
  console.log(' Passwords stored securely as bcrypt hashes.');
  console.log(' WARNING: Default credentials are intended for local assignment testing only.');
  console.log(' Change all credentials prior to any public or production deployment.');
  console.log('================================================================================\n');

  await mongoose.connection.close();
}

if (require.main === module) {
  setupAccounts()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Setup Error]:', err.message);
      process.exit(1);
    });
}

module.exports = { setupAccounts };
