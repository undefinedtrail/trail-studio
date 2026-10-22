const mongoose = require('mongoose');

// ============================================================================
// 1. Schemas & Models
// ============================================================================

// User Schema
// Roles supported: 'customer' and 'admin'
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
      enum: ['customer', 'admin'],
      default: 'customer',
    },
  },
  { timestamps: true }
);

// Painting Schema
// Paintings are one-of-a-kind. When bought, isAvailable becomes false.
const paintingSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
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

const User = mongoose.model('User', userSchema);
const Painting = mongoose.model('Painting', paintingSchema);
const Order = mongoose.model('Order', orderSchema);
const Booking = mongoose.model('Booking', bookingSchema);

// ============================================================================
// 2. Database Connection Helper
// ============================================================================
async function connectDB(mongoUri) {
  const uri = mongoUri || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/art_studio';
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
  // Strip time component to avoid timezone skew when booking a calendar day
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ============================================================================
// 4. Default Seed Data Helper
// ============================================================================
async function seedDefaults() {
  try {
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      console.log('[Seed] Seeding initial users...');
      await User.create([
        { email: 'admin@artstudio.com', role: 'admin' },
        { email: 'alice@example.com', role: 'customer' },
        { email: 'bob@example.com', role: 'customer' },
      ]);
      console.log('[Seed] Users seeded successfully.');
    }

    const paintingCount = await Painting.countDocuments();
    if (paintingCount === 0) {
      console.log('[Seed] Seeding sample paintings...');
      await Painting.create([
        {
          title: 'Sunset over Kyoto',
          price: 350,
          description: 'Original acrylic on canvas with textured gold leaf accents.',
          isAvailable: true,
        },
        {
          title: 'Morning Mist in the Valley',
          price: 480,
          description: 'Ethereal watercolor landscape capturing dawn on rough linen paper.',
          isAvailable: true,
        },
        {
          title: 'Abstract Geometry #4',
          price: 275,
          description: 'Minimalist study of form, shadow, and earthy pigments.',
          isAvailable: true,
        },
        {
          title: 'Ceramic Whisper',
          price: 520,
          description: 'Mixed media composition featuring layered clay wash and charcoal.',
          isAvailable: true,
        },
        {
          title: 'Night Sky Whispers',
          price: 610,
          description: 'Deep indigo oil painting with fine silver constellations.',
          isAvailable: true,
        },
      ]);
      console.log('[Seed] Paintings seeded successfully.');
    }
  } catch (err) {
    console.error('[Seed] Error seeding default data:', err.message);
  }
}

// Allow running seed directly via `node models/db.js --seed`
if (require.main === module && process.argv.includes('--seed')) {
  require('dotenv').config();
  connectDB().then(async () => {
    await seedDefaults();
    console.log('[Seed] Done.');
    process.exit(0);
  });
}

module.exports = {
  User,
  Painting,
  Order,
  Booking,
  connectDB,
  normalizeDate,
  seedDefaults,
};
