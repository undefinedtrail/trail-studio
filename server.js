require('dotenv').config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');

const {
  User,
  Painting,
  Order,
  Booking,
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
const RATE_PER_SQFT = Number(process.env.RATE_PER_SQFT) || 20;

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets from public/
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================================
// Public / Auth Utility Endpoints
// ============================================================================

// App Configuration (Pricing rate from seed data / env)
app.get('/api/config', (req, res) => {
  res.json({ ratePerSqFt: RATE_PER_SQFT });
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
      // Auto-register new user; if email contains 'admin' or role is explicitly set to admin, honor it
      const assignedRole = role === 'admin' ? 'admin' : 'customer';
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
// Paintings Endpoints
// ============================================================================

// 1. GET /api/paintings (Browse all paintings - open to logged-in users)
app.get('/api/paintings', authenticate, async (req, res) => {
  try {
    const paintings = await Painting.find({}).sort({ createdAt: -1 });
    res.json(paintings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve paintings: ' + err.message });
  }
});

// 2. POST /api/paintings (Add painting - Admin only)
// Note: Per spec, only the studio/admin can add paintings.
app.post('/api/paintings', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { title, price, description } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Painting title is required.' });
    }

    const priceNum = Number(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      return res.status(400).json({ error: 'Price must be a positive number greater than 0.' });
    }

    const painting = await Painting.create({
      title: title.trim(),
      price: priceNum,
      description: description ? description.trim() : '',
      isAvailable: true,
    });

    res.status(201).json({
      message: 'Painting added successfully.',
      painting,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add painting: ' + err.message });
  }
});

// 3. POST /api/paintings/:id/buy (Buy painting - Customer only)
// Atomic concurrency check: Painting is one of a kind and can only be bought once.
// We use findOneAndUpdate with condition { _id: id, isAvailable: true } to prevent race conditions.
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
      // Check if it exists or was already purchased
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
// Orders Endpoints
// ============================================================================

// GET /api/orders (Customer sees only what they own; Admin sees all)
app.get('/api/orders', authenticate, async (req, res) => {
  try {
    const query = req.user.role === 'admin' ? {} : { customerId: req.user._id };
    const orders = await Order.find(query)
      .populate('paintingId')
      .populate('customerId', 'email role')
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve orders: ' + err.message });
  }
});

// PATCH /api/orders/:id/cancel (Customer only - cancels their order and frees painting)
// Per spec: "A customer can cancel an order, and the painting becomes available again."
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
      message: 'Order cancelled successfully. The painting is now available again.',
      order,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel order: ' + err.message });
  }
});

// ============================================================================
// Wall Bookings Endpoints
// ============================================================================

// 1. POST /api/bookings (Book a wall date 7-90 days away, size 10-500 sq ft)
// Customer only; verifies date uniqueness & range, calculates price, handles double-booking.
app.post('/api/bookings', authenticate, requireRole('customer'), async (req, res) => {
  try {
    const { date, size, address } = req.body;

    // Validate size (10 - 500 sq ft)
    const sizeNum = Number(size);
    if (isNaN(sizeNum) || sizeNum < 10 || sizeNum > 500) {
      return res.status(400).json({
        error: 'Wall size must be between 10 and 500 sq ft.',
      });
    }

    // Validate address
    if (!address || typeof address !== 'string' || !address.trim()) {
      return res.status(400).json({
        error: 'Please provide a valid physical address for the wall painting.',
      });
    }

    // Validate date format & normalize to UTC midnight
    const normalizedDate = normalizeDate(date);
    if (!normalizedDate) {
      return res.status(400).json({
        error: 'Invalid booking date format. Please provide a valid date (YYYY-MM-DD).',
      });
    }

    // Date range validation: 7 to 90 days away from today
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

    // Calculate total price: wall size * rate from seed data / config
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
    // Catch MongoDB duplicate key error from partial unique index
    if (err.code === 11000) {
      return res.status(409).json({
        error: 'This date has already been booked. Please pick another date.',
      });
    }
    res.status(500).json({ error: 'Failed to create booking: ' + err.message });
  }
});

// 2. GET /api/bookings (List bookings: Customer sees only what they own; Admin sees all)
app.get('/api/bookings', authenticate, async (req, res) => {
  try {
    const query = req.user.role === 'admin' ? {} : { customerId: req.user._id };
    const bookings = await Booking.find(query)
      .populate('customerId', 'email role')
      .sort({ date: 1 });

    res.json(bookings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve bookings: ' + err.message });
  }
});

// 3. GET /api/bookings/:id (Get specific booking - enforces customer ownership or returns 404)
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

    // Spec Requirement: If a customer tries to query another customer's record, return 404
    if (!enforceOwnership(booking.customerId._id || booking.customerId, req.user)) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    res.json(booking);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve booking: ' + err.message });
  }
});

// 4. PATCH /api/bookings/:id/status (Confirm or decline booking - Admin only)
app.patch('/api/bookings/:id/status', authenticate, requireRole('admin'), async (req, res) => {
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

// 5. PATCH /api/bookings/:id/cancel (Customer only - can cancel until 3 days before the date)
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

    // Spec Requirement: Customer querying or modifying another customer's record gets 404
    if (!enforceOwnership(booking.customerId, req.user)) {
      return res.status(404).json({ error: 'Booking not found.' });
    }

    if (booking.status === 'cancelled') {
      return res.status(400).json({ error: 'Booking is already cancelled.' });
    }
    if (booking.status === 'declined') {
      return res.status(400).json({ error: 'Cannot cancel a booking that was already declined.' });
    }

    // 3-day cancellation window check:
    // "A customer can cancel until 3 days before the date."
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
// Fallback 404 Route for Unmatched API Endpoints
// ============================================================================
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
    app.listen(PORT, () => {
      console.log(`[Art Studio Server] Running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Fatal startup error:', err);
    process.exit(1);
  }
}

// Start if not in testing environment
if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
