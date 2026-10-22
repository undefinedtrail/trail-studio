require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const {
  User,
  Painting,
  Order,
  Booking,
  PotteryRequest,
  connectDB,
  normalizeDate,
  seedDefaults,
} = require('./models/db');

const {
  authenticate,
  requireRole,
  enforceOwnership,
} = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Load seed config from seed.json (Single source of truth for items, glazes, rates)
let seedConfig = {};
try {
  const seedPath = path.join(__dirname, 'seed.json');
  if (fs.existsSync(seedPath)) {
    seedConfig = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
  }
} catch (e) {
  console.warn('Could not read seed.json for dynamic config');
}

const RATE_PER_SQFT = Number(process.env.RATE_PER_SQFT) || (seedConfig.mural && seedConfig.mural.ratePerSqFt) || 150;
const CURRENCY = seedConfig.currency || 'INR';
const POTTERY_ITEMS = Array.isArray(seedConfig.potteryItems) ? seedConfig.potteryItems : [];
const GLAZES = Array.isArray(seedConfig.glazes) ? seedConfig.glazes : [];

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets and images from public/
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

// ============================================================================
// Public / Configuration & Auth Utility Endpoints
// ============================================================================

// App Configuration & Seed Options
app.get('/api/config', (req, res) => {
  res.json({
    studioName: 'Trail Studio',
    ratePerSqFt: RATE_PER_SQFT,
    currency: CURRENCY,
    potteryItems: POTTERY_ITEMS,
    glazes: GLAZES,
  });
});

// Pottery Catalog Options (Items & Glazes from seed data)
app.get('/api/pottery/options', authenticate, (req, res) => {
  res.json({
    items: POTTERY_ITEMS,
    glazes: GLAZES,
  });
});

// List users for demo quick-switch testing in the UI
app.get('/api/auth/users', async (req, res) => {
  try {
    const users = await User.find({}).sort({ role: 1, email: 1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users: ' + err.message });
  }
});

// Login / Switch User
// Finds user by email or creates a new customer user if it doesn't exist
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, role } = req.body;
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    let user = await User.findOne({ email: cleanEmail });

    if (!user) {
      const isStudio = role === 'admin' || role === 'studio' || cleanEmail.includes('studio');
      const assignedRole = isStudio ? 'studio' : 'customer';
      user = await User.create({ email: cleanEmail, role: assignedRole });
    }

    res.json({
      message: 'Logged in successfully',
      user,
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});

// Current Authenticated User Info
app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// ============================================================================
// 1. Paintings Endpoints
// ============================================================================

// GET /api/paintings (Browse all paintings - open to logged-in users)
app.get('/api/paintings', authenticate, async (req, res) => {
  try {
    const paintings = await Painting.find({}).sort({ createdAt: -1 });
    res.json(paintings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve paintings: ' + err.message });
  }
});

// POST /api/paintings (Add painting - Studio/Admin only)
app.post('/api/paintings', authenticate, requireRole('admin', 'studio'), async (req, res) => {
  try {
    const { title, price, artist, description, imageUrl } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Painting title is required.' });
    }

    const priceNum = Number(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      return res.status(400).json({ error: 'Price must be a positive number greater than 0.' });
    }

    const painting = await Painting.create({
      title: title.trim(),
      artist: artist ? artist.trim() : 'Trail Studio Artist',
      price: priceNum,
      description: description ? description.trim() : '',
      imageUrl: imageUrl ? imageUrl.trim() : '',
      isAvailable: true,
    });

    res.status(201).json({
      message: 'Painting added successfully to Trail Studio.',
      painting,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add painting: ' + err.message });
  }
});

// PATCH /api/paintings/:id (Edit painting - Studio/Admin only, only while available)
app.patch('/api/paintings/:id', authenticate, requireRole('admin', 'studio'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid painting ID.' });
    }

    const painting = await Painting.findById(id);
    if (!painting) {
      return res.status(404).json({ error: 'Painting not found.' });
    }

    // Business rule: Studio can edit paintings only while they are available
    if (!painting.isAvailable) {
      return res.status(400).json({
        error: 'Cannot edit painting: this painting has already been sold.',
      });
    }

    const { title, price, artist, description, imageUrl } = req.body;

    if (title !== undefined) {
      if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'Painting title cannot be empty.' });
      }
      painting.title = title.trim();
    }

    if (price !== undefined) {
      const priceNum = Number(price);
      if (isNaN(priceNum) || priceNum <= 0) {
        return res.status(400).json({ error: 'Price must be a positive number greater than 0.' });
      }
      painting.price = priceNum;
    }

    if (artist !== undefined) painting.artist = artist.trim();
    if (description !== undefined) painting.description = description.trim();
    if (imageUrl !== undefined) painting.imageUrl = imageUrl.trim();

    await painting.save();

    res.json({
      message: 'Painting updated successfully.',
      painting,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update painting: ' + err.message });
  }
});

// POST /api/paintings/:id/buy (Buy painting - Customer only)
// Atomic concurrency check: Painting is one of a kind and can only be bought once.
app.post('/api/paintings/:id/buy', authenticate, requireRole('customer'), async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid painting ID format.' });
    }

    // Atomic update ensures that only ONE concurrent request can successfully claim the painting
    const updatedPainting = await Painting.findOneAndUpdate(
      { _id: id, isAvailable: true },
      { $set: { isAvailable: false } },
      { new: true }
    );

    if (!updatedPainting) {
      const existingPainting = await Painting.findById(id);
      if (!existingPainting) {
        return res.status(404).json({ error: 'Painting not found.' });
      }
      return res.status(400).json({
        error: 'This painting has already been sold and is no longer available.',
      });
    }

    // Create the order for this customer
    const order = await Order.create({
      paintingId: updatedPainting._id,
      customerId: req.user._id,
      status: 'placed',
    });

    res.status(201).json({
      message: `You have successfully purchased "${updatedPainting.title}".`,
      order,
      painting: updatedPainting,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to complete purchase: ' + err.message });
  }
});

// ============================================================================
// 2. Orders Endpoints
// ============================================================================

// GET /api/orders (Customer sees only what they own; Studio sees all)
app.get('/api/orders', authenticate, async (req, res) => {
  try {
    const isStudio = req.user.role === 'admin' || req.user.role === 'studio';
    const query = isStudio ? {} : { customerId: req.user._id };
    const orders = await Order.find(query)
      .populate('paintingId')
      .populate('customerId', 'email role')
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve orders: ' + err.message });
  }
});

// PATCH /api/orders/:id/cancel (Customer only - cancels order and makes painting available again)
app.patch('/api/orders/:id/cancel', authenticate, requireRole('customer'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid order ID.' });
    }

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // Enforce ownership: Return 404 if customer tries to cancel someone else's order
    if (!enforceOwnership(order.customerId, req.user)) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Order is already cancelled.' });
    }

    order.status = 'cancelled';
    await order.save();

    // Make the painting available again
    await Painting.findByIdAndUpdate(order.paintingId, { isAvailable: true });

    res.json({
      message: 'Order cancelled successfully. The painting is now available again in Trail Studio.',
      order,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel order: ' + err.message });
  }
});

// ============================================================================
// 3. Wall Bookings Endpoints
// ============================================================================

// POST /api/bookings (Book a wall date 7-90 days away, size 10-500 sq ft)
app.post('/api/bookings', authenticate, requireRole('customer'), async (req, res) => {
  try {
    const { date, size, address } = req.body;

    const sizeNum = Number(size);
    if (isNaN(sizeNum) || sizeNum < 10 || sizeNum > 500) {
      return res.status(400).json({
        error: 'Wall size must be between 10 and 500 sq ft.',
      });
    }

    if (!address || typeof address !== 'string' || !address.trim()) {
      return res.status(400).json({
        error: 'Please provide a valid physical address for the wall painting.',
      });
    }

    const normalizedDate = normalizeDate(date);
    if (!normalizedDate) {
      return res.status(400).json({
        error: 'Invalid booking date format. Please provide a valid date (YYYY-MM-DD).',
      });
    }

    const nowUtc = normalizeDate(new Date());
    const diffMs = normalizedDate.getTime() - nowUtc.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 7 || diffDays > 90) {
      return res.status(400).json({
        error: `Booking date must be between 7 and 90 days from today. (Selected date is ${diffDays} days away).`,
      });
    }

    // Double-booking check: Each date can only be booked once for active bookings
    const existingBooking = await Booking.findOne({
      date: normalizedDate,
      status: { $in: ['requested', 'confirmed'] },
    });

    if (existingBooking) {
      return res.status(409).json({
        error: 'This date has already been booked. Please pick another date.',
      });
    }

    const price = sizeNum * RATE_PER_SQFT;

    const booking = new Booking({
      customerId: req.user._id,
      date: normalizedDate,
      size: sizeNum,
      address: address.trim(),
      price,
      status: 'requested',
    });

    await booking.save();

    res.status(201).json({
      message: 'Wall painting booking requested successfully!',
      booking,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        error: 'This date has already been booked. Please pick another date.',
      });
    }
    res.status(500).json({ error: 'Failed to create booking: ' + err.message });
  }
});

// GET /api/bookings (List bookings: Customer sees only what they own; Studio sees all)
app.get('/api/bookings', authenticate, async (req, res) => {
  try {
    const isStudio = req.user.role === 'admin' || req.user.role === 'studio';
    const query = isStudio ? {} : { customerId: req.user._id };
    const bookings = await Booking.find(query)
      .populate('customerId', 'email role')
      .sort({ date: 1 });

    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve bookings: ' + err.message });
  }
});

// GET /api/bookings/:id (Get specific booking - enforces customer ownership or returns 404)
app.get('/api/bookings/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    const booking = await Booking.findById(id).populate('customerId', 'email role');

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    if (!enforceOwnership(booking.customerId._id || booking.customerId, req.user)) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    res.json(booking);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve booking: ' + err.message });
  }
});

// PATCH /api/bookings/:id/status (Confirm or decline booking - Studio/Admin only)
app.patch('/api/bookings/:id/status', authenticate, requireRole('admin', 'studio'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid booking ID format.' });
    }

    if (!['confirmed', 'declined'].includes(status)) {
      return res.status(400).json({
        error: 'Status must be updated to either "confirmed" or "declined".',
      });
    }

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    booking.status = status;
    await booking.save();

    res.json({
      message: `Booking has been ${status}.`,
      booking,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update booking status: ' + err.message });
  }
});

// PATCH /api/bookings/:id/cancel (Customer only - can cancel until 3 days before the date)
app.patch('/api/bookings/:id/cancel', authenticate, requireRole('customer'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid booking ID format.' });
    }

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    if (!enforceOwnership(booking.customerId, req.user)) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    if (booking.status === 'cancelled') {
      return res.status(400).json({ error: 'Booking is already cancelled.' });
    }
    if (booking.status === 'declined') {
      return res.status(400).json({ error: 'Cannot cancel a booking that was already declined.' });
    }

    const todayUtc = normalizeDate(new Date());
    const bookingDateUtc = normalizeDate(booking.date);
    const diffDays = Math.round((bookingDateUtc.getTime() - todayUtc.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 3) {
      return res.status(400).json({
        error: `Cancellation refused: Bookings can only be cancelled at least 3 days in advance. (${diffDays} day(s) remaining).`,
      });
    }

    booking.status = 'cancelled';
    await booking.save();

    res.json({
      message: 'Booking cancelled successfully. The reserved date has been released.',
      booking,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel booking: ' + err.message });
  }
});

// ============================================================================
// 4. Custom Pottery Endpoints (Items & glazes validated against seed.json)
// ============================================================================

// Helper to validate pottery item & glaze IDs against seed data
function isValidPotteryItem(itemId) {
  return POTTERY_ITEMS.some((i) => i.id === itemId);
}

function isValidGlaze(glazeId) {
  return GLAZES.some((g) => g.id === glazeId);
}

// POST /api/pottery (Customer creates pottery request)
// Validates: authenticated customer, valid seed item, valid seed glaze, quantity 1-12, needed-by >= 14 days
app.post('/api/pottery', authenticate, requireRole('customer'), async (req, res) => {
  try {
    const { itemId, glazeId, quantity, neededBy } = req.body;

    // Validate item against seed data
    if (!itemId || !isValidPotteryItem(itemId)) {
      return res.status(400).json({
        error: 'Invalid pottery item. Please choose a valid item from the catalog.',
      });
    }

    // Validate glaze against seed data
    if (!glazeId || !isValidGlaze(glazeId)) {
      return res.status(400).json({
        error: 'Invalid glaze selection. Please choose a valid glaze from the catalog.',
      });
    }

    // Validate quantity: integer between 1 and 12
    const qtyNum = Number(quantity);
    if (!Number.isInteger(qtyNum) || qtyNum < 1 || qtyNum > 12) {
      return res.status(400).json({
        error: 'Quantity must be a whole number between 1 and 12.',
      });
    }

    // Validate needed-by date: at least 14 days away from today
    const normalizedDate = normalizeDate(neededBy);
    if (!normalizedDate) {
      return res.status(400).json({
        error: 'Invalid needed-by date format. Please provide a valid date (YYYY-MM-DD).',
      });
    }

    const todayUtc = normalizeDate(new Date());
    const diffMs = normalizedDate.getTime() - todayUtc.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 14) {
      return res.status(400).json({
        error: `Needed-by date must be at least 14 days away from today. (Selected date is ${diffDays} days away).`,
      });
    }

    const request = new PotteryRequest({
      customerId: req.user._id,
      itemId,
      glazeId,
      quantity: qtyNum,
      neededBy: normalizedDate,
      status: 'requested',
    });

    await request.save();

    res.status(201).json({
      message: 'Custom pottery request submitted successfully!',
      request,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create pottery request: ' + err.message });
  }
});

// GET /api/pottery (List pottery requests: Customer sees own; Studio sees all)
app.get('/api/pottery', authenticate, async (req, res) => {
  try {
    const isStudio = req.user.role === 'admin' || req.user.role === 'studio';
    const query = isStudio ? {} : { customerId: req.user._id };

    const requests = await PotteryRequest.find(query)
      .populate('customerId', 'email role')
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve pottery requests: ' + err.message });
  }
});

// GET /api/pottery/:id (Individual pottery request - customer privacy enforced or 404)
app.get('/api/pottery/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ error: 'Pottery request not found.' });
    }

    const request = await PotteryRequest.findById(id).populate('customerId', 'email role');
    if (!request) {
      return res.status(404).json({ error: 'Pottery request not found.' });
    }

    // Privacy rule: Customer attempting to access another customer's request gets 404 Not Found
    if (!enforceOwnership(request.customerId._id || request.customerId, req.user)) {
      return res.status(404).json({ error: 'Pottery request not found.' });
    }

    res.json(request);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve pottery request: ' + err.message });
  }
});

// PATCH /api/pottery/:id (Customer edits request - ONLY allowed while status === 'requested')
app.patch('/api/pottery/:id', authenticate, requireRole('customer'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ error: 'Pottery request not found.' });
    }

    const request = await PotteryRequest.findById(id);
    if (!request) {
      return res.status(404).json({ error: 'Pottery request not found.' });
    }

    // Customer ownership check
    if (!enforceOwnership(request.customerId, req.user)) {
      return res.status(404).json({ error: 'Pottery request not found.' });
    }

    // Business rule: A customer can edit a request ONLY while it is still 'requested'
    if (request.status !== 'requested') {
      return res.status(400).json({
        error: `Cannot edit pottery request: request has already been ${request.status}.`,
      });
    }

    const { itemId, glazeId, quantity, neededBy } = req.body;

    if (itemId !== undefined) {
      if (!isValidPotteryItem(itemId)) {
        return res.status(400).json({ error: 'Invalid pottery item.' });
      }
      request.itemId = itemId;
    }

    if (glazeId !== undefined) {
      if (!isValidGlaze(glazeId)) {
        return res.status(400).json({ error: 'Invalid glaze selection.' });
      }
      request.glazeId = glazeId;
    }

    if (quantity !== undefined) {
      const qtyNum = Number(quantity);
      if (!Number.isInteger(qtyNum) || qtyNum < 1 || qtyNum > 12) {
        return res.status(400).json({ error: 'Quantity must be an integer between 1 and 12.' });
      }
      request.quantity = qtyNum;
    }

    if (neededBy !== undefined) {
      const normalizedDate = normalizeDate(neededBy);
      if (!normalizedDate) {
        return res.status(400).json({ error: 'Invalid needed-by date format.' });
      }

      const todayUtc = normalizeDate(new Date());
      const diffMs = normalizedDate.getTime() - todayUtc.getTime();
      const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays < 14) {
        return res.status(400).json({
          error: `Needed-by date must be at least 14 days away from today. (Selected date is ${diffDays} days away).`,
        });
      }
      request.neededBy = normalizedDate;
    }

    await request.save();

    res.json({
      message: 'Pottery request updated successfully.',
      request,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update pottery request: ' + err.message });
  }
});

// PATCH /api/pottery/:id/cancel (Customer cancels request - ONLY allowed while status === 'requested')
app.patch('/api/pottery/:id/cancel', authenticate, requireRole('customer'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ error: 'Pottery request not found.' });
    }

    const request = await PotteryRequest.findById(id);
    if (!request) {
      return res.status(404).json({ error: 'Pottery request not found.' });
    }

    if (!enforceOwnership(request.customerId, req.user)) {
      return res.status(404).json({ error: 'Pottery request not found.' });
    }

    // Business rule: A customer can cancel a request ONLY while it is still 'requested'
    if (request.status !== 'requested') {
      return res.status(400).json({
        error: `Cannot cancel pottery request: request has already been ${request.status}.`,
      });
    }

    request.status = 'cancelled';
    await request.save();

    res.json({
      message: 'Pottery request cancelled successfully.',
      request,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel pottery request: ' + err.message });
  }
});

// PATCH /api/pottery/:id/status (Studio accepts or declines request - only transitions from 'requested')
app.patch('/api/pottery/:id/status', authenticate, requireRole('admin', 'studio'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid pottery request ID.' });
    }

    if (!['accepted', 'declined'].includes(status)) {
      return res.status(400).json({
        error: 'Status must be updated to either "accepted" or "declined".',
      });
    }

    const request = await PotteryRequest.findById(id);
    if (!request) {
      return res.status(404).json({ error: 'Pottery request not found.' });
    }

    // Transition only allowed from 'requested'
    if (request.status !== 'requested') {
      return res.status(400).json({
        error: `Cannot update status: request has already been ${request.status}.`,
      });
    }

    request.status = status;
    await request.save();

    res.json({
      message: `Pottery request has been ${status}.`,
      request,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update pottery status: ' + err.message });
  }
});

// Fallback 404 Route for Unmatched API Endpoints
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API route ${req.method} ${req.path} not found.` });
});

// Serve index.html for root or SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================================
// Server Startup
// ============================================================================
async function startServer() {
  try {
    await connectDB();
    await seedDefaults();
    const serverInstance = app.listen(PORT, () => {
      console.log(`[Trail Studio Server] Running on http://localhost:${PORT}`);
    });
    return serverInstance;
  } catch (err) {
    console.error('Fatal startup error:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
