const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

// ============================================================================
// 1. Schemas & Models
// ============================================================================

// User Schema
// Roles supported: 'customer', 'studio', and 'admin' ('studio' and 'admin' are synonymous)
const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
    },
    role: {
      type: String,
      required: true,
      enum: ['customer', 'studio', 'admin'],
      default: 'customer',
    },
  },
  { timestamps: true }
);

// Hash password before saving if it has been modified
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Compare candidate password with stored hash
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Painting Schema
// Each painting is one-of-a-kind. When bought, isAvailable becomes false.
const paintingSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      trim: true,
      default: '',
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
    },
    artist: {
      type: String,
      trim: true,
      default: 'Trail Studio Artist',
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
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
// Tracks paintings purchased by customers
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
// Wall size must be 10-500 sq ft. Each calendar date can have only one active booking.
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

// Concurrency Guard:
// Partial unique index ensures that no two active bookings ('requested' or 'confirmed')
// can occupy the exact same date, even under simultaneous concurrent submissions.
bookingSchema.index(
  { date: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['requested', 'confirmed'] } },
  }
);

// PotteryRequest Schema (Custom Pottery)
// Customers choose item & glaze from seed data, quantity (1-12), and needed-by date >= 14 days.
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
// 2. Database Connection Helper with Test Isolation
// ============================================================================
function getMongoUri() {
  if (process.env.NODE_ENV === 'test') {
    return process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/trail_studio_test';
  }
  return process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/trail_studio';
}

let transactionsSupported = false;

function supportsTransactions() {
  return transactionsSupported;
}

async function connectDB(customUri) {
  const uri = customUri || getMongoUri();
  try {
    await mongoose.connect(uri);
    console.log(`[Database] Connected to MongoDB at ${uri}`);
    try {
      const hello = await mongoose.connection.db.admin().command({ hello: 1 });
      transactionsSupported = Boolean(hello && (hello.setName || hello.msg === 'isdbgrid'));
      if (transactionsSupported) {
        console.log('[Database] Replica set detected: multi-document transactions enabled.');
      } else {
        console.log('[Database] Standalone MongoDB detected: atomic operations with compensating rollback enabled.');
      }
    } catch (e) {
      transactionsSupported = false;
    }
  } catch (err) {
    console.error('[Database] MongoDB connection error:', err.message);
    throw err;
  }
}

// ============================================================================
// 3. Helper: Normalize Date to UTC Midnight (avoids timezone skew)
// ============================================================================
function normalizeDate(input) {
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ============================================================================
// 4. Default Seed Data Helper (Uses seed.json)
// ============================================================================
async function seedDefaults() {
  try {
    const seedPath = path.join(__dirname, '..', 'seed.json');
    let seedData = null;

    if (fs.existsSync(seedPath)) {
      const raw = fs.readFileSync(seedPath, 'utf-8');
      seedData = JSON.parse(raw);
    }

    // Seed or update default studio and customer accounts with valid hashed passwords
    const studioEmail = (seedData && seedData.studioAccount && seedData.studioAccount.email)
      ? seedData.studioAccount.email.toLowerCase()
      : 'studio@artstudio.in';
    const studioPass = (seedData && seedData.studioAccount && seedData.studioAccount.password)
      ? seedData.studioAccount.password
      : 'Studio@123';

    const defaultAccounts = [
      { email: studioEmail, role: 'studio', password: studioPass },
      { email: 'alice@example.com', role: 'customer', password: 'Customer@123' },
      { email: 'bob@example.com', role: 'customer', password: 'Customer@123' },
    ];

    for (const acc of defaultAccounts) {
      let existing = await User.findOne({ email: acc.email });
      if (!existing) {
        const u = new User(acc);
        await u.save();
      } else if (!existing.password || !existing.password.startsWith('$2')) {
        existing.password = acc.password;
        await existing.save(); // pre-save hook will hash it with bcrypt
      }
    }

    // Seed paintings from seed.json
    const paintingCount = await Painting.countDocuments();
    if (paintingCount === 0 && seedData && Array.isArray(seedData.paintings)) {
      console.log('[Seed] Seeding paintings from seed.json...');
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
  getMongoUri,
  normalizeDate,
  seedDefaults,
  supportsTransactions,
};
