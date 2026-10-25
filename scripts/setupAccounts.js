require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB, seedDefaults, User } = require('../models/db');

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
