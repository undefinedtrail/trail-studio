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
  generateToken,
  authenticate,
  requireRole,
  enforceOwnership,
} = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Load seed config from seed.json (Single source of truth for catalog & rates)
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
// Public / Configuration Endpoints
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

// Pottery Catalog Options (Available to authenticated users)
app.get('/api/pottery/options', authenticate, (req, res) => {
  res.json({
    items: POTTERY_ITEMS,
    glazes: GLAZES,
  });
});

// ============================================================================
// Authentication & Accounts (Email / Password + Signed JWT)
// ============================================================================

// Customer Registration
// Public endpoint for customer sign-up. Role is strictly locked to 'customer'.
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = email.trim().toLowerCase();
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email format.' });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      return res.status(400).json({ error: 'This email address is already registered.' });
    }

    // Role is strictly locked to 'customer' - customers cannot register as studio
    const user = new User({
      email: cleanEmail,
      password,
      role: 'customer',
    });

    await user.save();

    const token = generateToken(user);
    res.status(201).json({
      message: 'Account created successfully.',
      token,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

// Login (Email + Password)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isMatch = await user.comparePassword(String(password));
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = generateToken(user);
    res.json({
      message: 'Logged in successfully.',
      token,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});

// Current Authenticated User Info
app.get('/api/auth/me', authenticate, (req, res) => {
  res.json({
    user: {
      id: req.user._id,
      email: req.user.email,
      role: req.user.role,
    },
  });
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

// POST /api/paintings (Add painting - Studio only)
app.post('/api/paintings', authenticate, requireRole('admin', 'studio'), async (req, res) => {
  try {
    const { title, price, artist, description, imageUrl } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Painting title is required.' });
    }

    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      return res.status(400).json({ error: 'Price must be a valid positive number.' });
    }

    const painting = await Painting.create({
      title: title.trim(),
      artist: artist && typeof artist === 'string' ? artist.trim() : 'Trail Studio Artist',
      price: priceNum,
      description: description && typeof description === 'string' ? description.trim() : '',
      imageUrl: imageUrl && typeof imageUrl === 'string' ? imageUrl.trim() : '',
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

// PATCH /api/paintings/:id (Edit painting - Studio only, allowed only while available)
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
      if (!Number.isFinite(priceNum) || priceNum <= 0) {
        return res.status(400).json({ error: 'Price must be a valid positive number.' });
      }
      painting.price = priceNum;
    }

    if (artist !== undefined) painting.artist = String(artist).trim();
    if (description !== undefined) painting.description = String(description).trim();
    if (imageUrl !== undefined) painting.imageUrl = String(imageUrl).trim();

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
// Concurrency rule: Paintings are one of a kind. Atomic findOneAndUpdate prevents race conditions.
app.post('/api/paintings/:id/buy', authenticate, requireRole('customer'), async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid painting ID format.' });
    }

    // Atomic condition ensures only ONE concurrent request can transition availability from true to false
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

    // Create the order for the customer
    let order;
    try {
      order = await Order.create({
        paintingId: updatedPainting._id,
        customerId: req.user._id,
        status: 'placed',
      });
    } catch (orderErr) {
      // Compensating action: roll back painting availability if order creation fails
      await Painting.findByIdAndUpdate(id, { isAvailable: true });
      throw orderErr;
    }

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

// GET /api/orders (Customer sees own orders; Studio sees all orders)
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

// PATCH /api/orders/:id/cancel (Customer only - cancels order and restores painting availability)
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

    // Customer privacy: viewing/cancelling another customer's order returns 404
    if (!enforceOwnership(order.customerId, req.user)) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Order is already cancelled.' });
    }
    if (order.status !== 'placed') {
      return res.status(400).json({ error: 'Only placed orders can be cancelled.' });
    }

    // Atomic update prevents duplicate cancellations
    const cancelledOrder = await Order.findOneAndUpdate(
      { _id: id, status: 'placed', customerId: req.user._id },
      { $set: { status: 'cancelled' } },
      { new: true }
    );

    if (!cancelledOrder) {
      return res.status(400).json({ error: 'Order is already cancelled or cannot be modified.' });
    }

    // Return the painting to the available catalog
    await Painting.findByIdAndUpdate(cancelledOrder.paintingId, { isAvailable: true });

    res.json({
      message: 'Order cancelled successfully. The artwork is now available again in Trail Studio.',
      order: cancelledOrder,
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

    // Strict numeric validation for size (10 to 500 sq ft)
    const sizeNum = Number(size);
    if (!Number.isFinite(sizeNum) || sizeNum < 10 || sizeNum > 500) {
      return res.status(400).json({
        error: 'Wall size must be a valid number between 10 and 500 sq ft.',
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

    // Boundary check: 7 to 90 days from today
    const nowUtc = normalizeDate(new Date());
    const diffMs = normalizedDate.getTime() - nowUtc.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 7 || diffDays > 90) {
      return res.status(400).json({
        error: `Booking date must be between 7 and 90 days from today. (Selected date is ${diffDays} days away).`,
      });
    }

    // Check if date already has an active booking (requested or confirmed)
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
    // Intercept MongoDB duplicate key error from partial unique index
    if (err.code === 11000) {
      return res.status(409).json({
        error: 'This date has already been booked. Please pick another date.',
      });
    }
    res.status(500).json({ error: 'Failed to create booking: ' + err.message });
  }
});

// GET /api/bookings (Customer sees own bookings; Studio sees all bookings)
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

// GET /api/bookings/:id (Enforces customer ownership or returns 404)
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

// PATCH /api/bookings/:id/status (Studio confirm/decline: only transitions from 'requested')
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

    // Do not allow cancelled or declined bookings to be modified or confirmed later
    if (booking.status === 'confirmed') {
      return res.status(400).json({ error: 'Booking has already been confirmed.' });
    }
    if (booking.status === 'declined') {
      return res.status(400).json({ error: 'Cannot modify a booking that was already declined.' });
    }
    if (booking.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot modify a booking that has been cancelled.' });
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

// PATCH /api/bookings/:id/cancel (Customer only - allowed up to 3 days before the date)
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

    // 3-day lead time check
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
// 4. Custom Pottery Endpoints (Items & Glazes validated against seed.json)
// ============================================================================

function isValidPotteryItem(itemId) {
  return POTTERY_ITEMS.some((i) => i.id === itemId);
}

function isValidGlaze(glazeId) {
  return GLAZES.some((g) => g.id === glazeId);
}

// POST /api/pottery (Customer creates pottery request)
app.post('/api/pottery', authenticate, requireRole('customer'), async (req, res) => {
  try {
    const { itemId, glazeId, quantity, neededBy } = req.body;

    if (!itemId || !isValidPotteryItem(itemId)) {
      return res.status(400).json({
        error: 'Invalid pottery item. Please select a valid item from the catalog.',
      });
    }

    if (!glazeId || !isValidGlaze(glazeId)) {
      return res.status(400).json({
        error: 'Invalid glaze selection. Please select a valid glaze from the catalog.',
      });
    }

    // Strict integer validation for quantity (1 to 12)
    const qtyNum = Number(quantity);
    if (!Number.isInteger(qtyNum) || qtyNum < 1 || qtyNum > 12) {
      return res.status(400).json({
        error: 'Quantity must be a whole number between 1 and 12.',
      });
    }

    const normalizedDate = normalizeDate(neededBy);
    if (!normalizedDate) {
      return res.status(400).json({
        error: 'Invalid needed-by date format. Please provide a valid date (YYYY-MM-DD).',
      });
    }

    // Lead time validation: at least 14 days away from today
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

// GET /api/pottery (Customer sees own requests; Studio sees all requests)
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

// GET /api/pottery/:id (Enforces customer ownership or returns 404)
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

    if (!enforceOwnership(request.customerId, req.user)) {
      return res.status(404).json({ error: 'Pottery request not found.' });
    }

    // Business rule: Edit allowed ONLY while status is 'requested'
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
        return res.status(400).json({ error: 'Quantity must be a whole number between 1 and 12.' });
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

    // Business rule: Cancel allowed ONLY while status is 'requested'
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

// PATCH /api/pottery/:id/status (Studio accepts or declines: only transitions from 'requested')
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
