const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// ============================================================================
// 1. Schemas & Models
// ============================================================================

// User Schema
// Roles supported: 'customer', 'admin', and 'studio' (admin & studio are synonyms)
const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    role: {
      type: String,
      required: true,
      enum: ['customer', 'admin', 'studio'],
      default: 'customer',
    },
    password: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

// Painting Schema
// Paintings are one-of-a-kind. When bought, isAvailable becomes false.
const paintingSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      trim: true,
      default: '',
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    artist: {
      type: String,
      trim: true,
      default: 'Trail Studio Artist',
    },
    price: {
      type: Number,
      required: true,
      min: [1, 'Price must be greater than 0'],
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    imageUrl: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { timestamps: true }
);

// Order Schema
// Tracks paintings purchased by customers.
const orderSchema = new mongoose.Schema(
  {
    paintingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Painting',
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['placed', 'cancelled'],
      default: 'placed',
    },
  },
  { timestamps: true }
);

// Booking Schema (Wall Painting)
// Wall size must be 10-500 sq ft. Each calendar date can only be booked once.
const bookingSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    size: {
      type: Number,
      required: true,
      min: [10, 'Wall size must be at least 10 sq ft'],
      max: [500, 'Wall size cannot exceed 500 sq ft'],
    },
    address: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['requested', 'confirmed', 'declined', 'cancelled'],
      default: 'requested',
    },
  },
  { timestamps: true }
);

// Concurrency & Double-Booking Guard:
// Partial unique index ensures that no two active bookings ('requested' or 'confirmed')
// can occupy the exact same date, even under concurrent database requests.
bookingSchema.index(
  { date: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['requested', 'confirmed'] } },
  }
);

// PotteryRequest Schema (Custom Pottery)
// Customers choose item & glaze from seed.json, quantity (1-12), and needed-by date >= 14 days.
const potteryRequestSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    itemId: {
      type: String,
      required: true,
      trim: true,
    },
    glazeId: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'Quantity must be at least 1'],
      max: [12, 'Quantity cannot exceed 12'],
    },
    neededBy: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['requested', 'accepted', 'declined', 'cancelled'],
      default: 'requested',
    },
  },
  { timestamps: true }
);

const User = mongoose.model('User', userSchema);
const Painting = mongoose.model('Painting', paintingSchema);
const Order = mongoose.model('Order', orderSchema);
const Booking = mongoose.model('Booking', bookingSchema);
const PotteryRequest = mongoose.model('PotteryRequest', potteryRequestSchema);

// ============================================================================
// 2. Database Connection Helper
// ============================================================================
async function connectDB(mongoUri) {
  const uri = mongoUri || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/trail_studio';
  try {
    await mongoose.connect(uri);
    console.log(`[Database] Connected to MongoDB at ${uri}`);
  } catch (err) {
    console.error('[Database] MongoDB connection error:', err.message);
    throw err;
  }
}

// ============================================================================
// 3. Helper: Normalize Date to UTC Midnight
// ============================================================================
function normalizeDate(input) {
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ============================================================================
// 4. Default Seed Data Helper (Uses seed.json strictly)
// ============================================================================
async function seedDefaults() {
  try {
    const seedPath = path.join(__dirname, '..', 'seed.json');
    let seedData = null;

    if (fs.existsSync(seedPath)) {
      const raw = fs.readFileSync(seedPath, 'utf-8');
      seedData = JSON.parse(raw);
    }

    // Seed studio user and sample customers
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      console.log('[Seed] Seeding initial users from seedData...');
      const studioEmail = (seedData && seedData.studioAccount && seedData.studioAccount.email) 
        ? seedData.studioAccount.email.toLowerCase() 
        : 'studio@artstudio.in';
      const studioPass = (seedData && seedData.studioAccount && seedData.studioAccount.password) 
        ? seedData.studioAccount.password 
        : 'Studio@123';

      await User.create([
        { email: studioEmail, role: 'studio', password: studioPass },
        { email: 'admin@trail.studio', role: 'admin' },
        { email: 'alice@example.com', role: 'customer' },
        { email: 'bob@example.com', role: 'customer' },
      ]);
      console.log('[Seed] Users seeded successfully.');
    }

    // Seed paintings from seed.json
    const paintingCount = await Painting.countDocuments();
    if (paintingCount === 0 && seedData && Array.isArray(seedData.paintings)) {
      console.log('[Seed] Seeding paintings strictly from seed.json...');
      const paintingDocs = seedData.paintings.map((p) => ({
        code: p.id,
        title: p.title,
        artist: p.artist || 'Trail Studio Artist',
        description: p.description || '',
        price: p.price,
        imageUrl: p.imageUrl ? '/' + p.imageUrl.replace(/^\//, '') : '',
        isAvailable: p.status === 'available',
      }));

      await Painting.insertMany(paintingDocs);
      console.log(`[Seed] Seeded ${paintingDocs.length} paintings from seed.json.`);
    }
  } catch (err) {
    console.error('[Seed] Error seeding default data:', err.message);
  }
}

// Allow running seed directly via `node models/db.js --seed`
if (require.main === module && process.argv.includes('--seed')) {
  require('dotenv').config();
  connectDB().then(async () => {
    await Painting.deleteMany({});
    await seedDefaults();
    console.log('[Seed] Re-seeded paintings from seed.json.');
    process.exit(0);
  });
}

module.exports = {
  User,
  Painting,
  Order,
  Booking,
  PotteryRequest,
  connectDB,
  normalizeDate,
  seedDefaults,
};
