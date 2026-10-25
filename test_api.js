// test_api.js - Automated API & Security Test Suite for Trail Studio
// Configured to run against an isolated test database (trail_studio_test)
process.env.NODE_ENV = 'test';
require('dotenv').config();

const http = require('http');
const { app } = require('./server');
const { connectDB, seedDefaults, User, Painting, Booking, Order, PotteryRequest } = require('./models/db');

let server;
const PORT = 3001;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function request(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqHeaders = { ...headers };
    let bodyData = null;

    if (body) {
      bodyData = JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyData);
    }

    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(rawData);
          } catch (e) {
            json = rawData;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        });
      }
    );

    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  } else {
    console.log(`✅ PASSED: ${message}`);
  }
}

async function runTests() {
  console.log('--- Starting Trail Studio API & Security Test Suite ---');
  await connectDB();

  // Strict Safety Check: Tests MUST run only against an isolated test database
  const mongoose = require('mongoose');
  const activeDbName = mongoose.connection.name;
  if (!activeDbName || !activeDbName.toLowerCase().includes('test')) {
    console.error(`\n❌ FATAL SAFETY CHECK: Refusing to run destructive cleanup on database "${activeDbName}"!`);
    console.error('Tests are strictly restricted to databases containing "test" in their name (e.g. trail_studio_test).\n');
    process.exit(1);
  }

  if (process.env.NODE_ENV !== 'test') {
    console.error(`\n❌ FATAL SAFETY CHECK: NODE_ENV must be explicitly set to "test" (current: "${process.env.NODE_ENV}").\n`);
    process.exit(1);
  }

  await seedDefaults();

  // Reset test artifacts in the isolated test database
  await User.deleteMany({});
  await Booking.deleteMany({});
  await Order.deleteMany({});
  await PotteryRequest.deleteMany({});
  await Painting.updateMany({}, { isAvailable: true });

  // Seed test accounts with bcrypt hashed passwords
  await User.create([
    { email: 'admin@gmail.com', password: 'admin123', role: 'admin' },
    { email: 'user@gmail.com', password: 'user123', role: 'customer' },
    { email: 'user2@example.com', password: 'user123', role: 'customer' },
  ]);

  server = app.listen(PORT);
  console.log(`Test server running on port ${PORT}`);

  try {
    // ========================================================================
    // 1. Authentication, Password Hashing & JWT Security
    // ========================================================================
    console.log('\n[1] Testing Authentication & Security:');

    // Unauthenticated request without token returns 401
    let res = await request('GET', '/api/paintings');
    assert(res.status === 401, 'Unauthenticated request to /api/paintings returns 401');

    // Invalid/tampered token returns 401
    res = await request('GET', '/api/paintings', { Authorization: 'Bearer bad.token.here' });
    assert(res.status === 401, 'Invalid Bearer token returns 401');

    // Login with wrong password returns 401
    res = await request('POST', '/api/auth/login', {}, { email: 'admin@gmail.com', password: 'WrongPassword' });
    assert(res.status === 401, 'Login with incorrect password returns 401');

    // Login with Administrator credentials
    res = await request('POST', '/api/auth/login', {}, { email: 'admin@gmail.com', password: 'admin123' });
    assert(res.status === 200, 'Administrator login successful (200)');
    assert(res.body.token && (res.body.user.role === 'admin' || res.body.user.role === 'studio'), 'Admin receives signed token with admin role');
    const adminToken = `Bearer ${res.body.token}`;

    // Login with Customer credentials
    res = await request('POST', '/api/auth/login', {}, { email: 'user@gmail.com', password: 'user123' });
    assert(res.status === 200, 'Customer login successful (200)');
    assert(res.body.token && res.body.user.role === 'customer', 'Customer receives signed token with customer role');
    const customerToken = `Bearer ${res.body.token}`;

    // Login with secondary Customer credentials (for multi-user concurrency & privacy tests)
    res = await request('POST', '/api/auth/login', {}, { email: 'user2@example.com', password: 'user123' });
    assert(res.status === 200, 'Secondary customer login successful (200)');
    const customer2Token = `Bearer ${res.body.token}`;

    // Customer Registration: Role must be strictly 'customer'
    res = await request('POST', '/api/auth/register', {}, { email: 'newbie@example.com', password: 'Password123', role: 'admin' });
    assert(res.status === 201, 'Customer registration successful (201)');
    assert(res.body.user.role === 'customer', 'Registration strictly forces customer role even if admin role was requested');

    // Duplicate email registration is rejected
    res = await request('POST', '/api/auth/register', {}, { email: 'newbie@example.com', password: 'Password123' });
    assert(res.status === 400, 'Duplicate email registration rejected with 400');

    // GET /api/auth/me returns authenticated user
    res = await request('GET', '/api/auth/me', { Authorization: customerToken });
    assert(res.status === 200 && res.body.user.email === 'user@gmail.com', 'GET /api/auth/me returns authenticated user profile');

    // Verify unauthenticated /api/auth/switch endpoint is removed (must return 404)
    res = await request('POST', '/api/auth/switch', {}, { email: 'admin@gmail.com' });
    assert(res.status === 404, 'Unauthenticated /api/auth/switch endpoint is removed (returns 404)');

    // ========================================================================
    // 2. Paintings Browsing, Creation, Editing & Purchase Concurrency
    // ========================================================================
    console.log('\n[2] Testing Paintings Browsing & RBAC:');

    // Customer can browse paintings
    res = await request('GET', '/api/paintings', { Authorization: customerToken });
    assert(res.status === 200 && Array.isArray(res.body) && res.body.length >= 10, 'Customer can browse catalog paintings');
    const targetPainting = res.body.find((p) => p.isAvailable);
    assert(!!targetPainting, 'Found available painting in catalog');

    // Customer cannot add painting -> 403
    res = await request('POST', '/api/paintings', { Authorization: customerToken }, { title: 'Unauthorized Art', price: 9999 });
    assert(res.status === 403, 'Customer cannot add painting (returns 403 Forbidden)');

    // Admin adds a painting -> 201
    res = await request('POST', '/api/paintings', { Authorization: adminToken }, {
      title: 'Bhil Art Deer Sanctuary',
      artist: 'Lado Bai',
      price: 9500,
      description: 'Traditional Bhil dot-pattern painting',
    });
    assert(res.status === 201, 'Admin can add painting (returns 201 Created)');
    const newlyAddedPainting = res.body.painting;

    // Admin edits painting while available -> 200
    res = await request('PATCH', `/api/paintings/${newlyAddedPainting._id}`, { Authorization: adminToken }, {
      price: 10500,
      description: 'Updated: Traditional Bhil dot-pattern painting on canvas',
    });
    assert(res.status === 200, 'Admin can edit painting while available (returns 200)');
    assert(res.body.painting.price === 10500, 'Painting price updated successfully');

    // Customer cannot edit painting -> 403
    res = await request('PATCH', `/api/paintings/${newlyAddedPainting._id}`, { Authorization: customerToken }, { price: 5000 });
    assert(res.status === 403, 'Customer cannot edit painting (returns 403 Forbidden)');

    // Admin cannot buy paintings -> 403
    res = await request('POST', `/api/paintings/${newlyAddedPainting._id}/buy`, { Authorization: adminToken });
    assert(res.status === 403, 'Admin cannot buy paintings (returns 403 Forbidden)');

    // Concurrency: Customer buys painting
    console.log('\n[3] Testing Painting Purchase Concurrency:');
    res = await request('POST', `/api/paintings/${newlyAddedPainting._id}/buy`, { Authorization: customerToken });
    assert(res.status === 201, 'Customer successfully bought painting (returns 201)');
    assert(res.body.painting.isAvailable === false, 'Painting isAvailable set to false');
    const orderId = res.body.order._id;

    // Second simultaneous/competing buy attempt is refused with 400
    res = await request('POST', `/api/paintings/${newlyAddedPainting._id}/buy`, { Authorization: customer2Token });
    assert(res.status === 400, 'Second attempt to buy same painting is refused with 400');
    assert(res.body && res.body.error && res.body.error.toLowerCase().includes('sold'), 'Clear refusal message: painting already sold');

    // Test concurrent purchases on another available painting:
    const availablePaintings = await Painting.find({ isAvailable: true, _id: { $ne: newlyAddedPainting._id } });
    if (availablePaintings.length > 0) {
      const concurrentTarget = availablePaintings[0];
      const [buy1, buy2] = await Promise.all([
        request('POST', `/api/paintings/${concurrentTarget._id}/buy`, { Authorization: customerToken }),
        request('POST', `/api/paintings/${concurrentTarget._id}/buy`, { Authorization: customer2Token })
      ]);
      const statuses = [buy1.status, buy2.status].sort();
      assert(statuses[0] === 201 && statuses[1] === 400, 'Concurrent purchases resolve strictly: exactly one 201, one 400');
    }

    // Admin cannot edit painting after it is sold -> 400
    res = await request('PATCH', `/api/paintings/${newlyAddedPainting._id}`, { Authorization: adminToken }, { price: 12000 });
    assert(res.status === 400, 'Admin cannot edit painting after it is sold (returns 400)');

    // ========================================================================
    // 3. Wall Painting Bookings
    // ========================================================================
    console.log('\n[4] Testing Wall Bookings:');

    // Date boundary checks (< 7 days or > 90 days)
    const nearDate = new Date();
    nearDate.setDate(nearDate.getDate() + 2);
    const nearDateStr = nearDate.toISOString().split('T')[0];

    res = await request('POST', '/api/bookings', { Authorization: customerToken }, { date: nearDateStr, size: 50, address: '45 Heritage Colony' });
    assert(res.status === 400, 'Booking date < 7 days is rejected (returns 400)');

    const farDate = new Date();
    farDate.setDate(farDate.getDate() + 95);
    const farDateStr = farDate.toISOString().split('T')[0];

    res = await request('POST', '/api/bookings', { Authorization: customerToken }, { date: farDateStr, size: 50, address: '45 Heritage Colony' });
    assert(res.status === 400, 'Booking date > 90 days is rejected (returns 400)');

    // Size boundary checks (< 10, > 500, NaN)
    const validDate = new Date();
    validDate.setDate(validDate.getDate() + 15);
    const validDateStr = validDate.toISOString().split('T')[0];

    res = await request('POST', '/api/bookings', { Authorization: customerToken }, { date: validDateStr, size: 5, address: '45 Heritage Colony' });
    assert(res.status === 400, 'Wall size < 10 sq ft rejected (returns 400)');

    res = await request('POST', '/api/bookings', { Authorization: customerToken }, { date: validDateStr, size: 600, address: '45 Heritage Colony' });
    assert(res.status === 400, 'Wall size > 500 sq ft rejected (returns 400)');

    res = await request('POST', '/api/bookings', { Authorization: customerToken }, { date: validDateStr, size: 'not-a-number', address: '45 Heritage Colony' });
    assert(res.status === 400, 'Invalid non-numeric wall size rejected (returns 400)');

    // Valid booking creation: 100 sq ft * 150 = 15000
    res = await request('POST', '/api/bookings', { Authorization: customerToken }, { date: validDateStr, size: 100, address: '45 Heritage Colony, Jaipur' });
    assert(res.status === 201, 'Valid wall booking created (returns 201)');
    assert(res.body.booking.price === 15000, 'Price calculated correctly with seed rate (100 * 150 = 15000)');
    const customerBookingId = res.body.booking._id;

    // Double-booking conflict check: customer2 attempts to book the same date -> 409
    res = await request('POST', '/api/bookings', { Authorization: customer2Token }, { date: validDateStr, size: 50, address: '99 Civil Lines' });
    assert(res.status === 409, 'Double booking same date is rejected (returns 409 Conflict)');
    assert(res.body.error && res.body.error.includes('already been booked'), 'Clear refusal message: date already booked');

    // Customer privacy: customer2 viewing customer's booking returns 404 Not Found
    res = await request('GET', `/api/bookings/${customerBookingId}`, { Authorization: customer2Token });
    assert(res.status === 404, "Customer viewing another customer's booking returns 404 Not Found");

    // Admin confirms booking
    res = await request('PATCH', `/api/bookings/${customerBookingId}/status`, { Authorization: adminToken }, { status: 'confirmed' });
    assert(res.status === 200, 'Admin confirmed booking (returns 200 OK)');
    assert(res.body.booking.status === 'confirmed', 'Booking status is now "confirmed"');

    // Admin cannot confirm an already confirmed booking -> 400
    res = await request('PATCH', `/api/bookings/${customerBookingId}/status`, { Authorization: adminToken }, { status: 'confirmed' });
    assert(res.status === 400, 'Admin cannot re-confirm an already confirmed booking (returns 400)');

    // Customer cancels order -> Painting becomes available again
    res = await request('PATCH', `/api/orders/${orderId}/cancel`, { Authorization: customerToken });
    assert(res.status === 200, 'Customer cancelled order (returns 200 OK)');

    const paintingCheck = await Painting.findById(newlyAddedPainting._id);
    assert(paintingCheck.isAvailable === true, 'Painting is available again after customer cancelled order');

    // Customer cannot duplicate-cancel already cancelled order -> 400
    res = await request('PATCH', `/api/orders/${orderId}/cancel`, { Authorization: customerToken });
    assert(res.status === 400, 'Customer cannot cancel an already cancelled order (returns 400)');

    // Test concurrent order cancellation: exactly one succeeds
    const freshPainting = await Painting.findOne({ isAvailable: true });
    if (freshPainting) {
      const freshBuy = await request('POST', `/api/paintings/${freshPainting._id}/buy`, { Authorization: customerToken });
      const freshOrderId = freshBuy.body.order._id;
      const [cancel1, cancel2] = await Promise.all([
        request('PATCH', `/api/orders/${freshOrderId}/cancel`, { Authorization: customerToken }),
        request('PATCH', `/api/orders/${freshOrderId}/cancel`, { Authorization: customerToken })
      ]);
      const cancelStatuses = [cancel1.status, cancel2.status].sort();
      assert(cancelStatuses[0] === 200 && cancelStatuses[1] === 400, 'Concurrent order cancellations resolve strictly: one 200, one 400');
    }

    // Customer cancels booking -> Date released
    res = await request('PATCH', `/api/bookings/${customerBookingId}/cancel`, { Authorization: customerToken });
    assert(res.status === 200, 'Customer cancelled booking (returns 200 OK)');

    // Admin cannot confirm a cancelled booking -> 400
    res = await request('PATCH', `/api/bookings/${customerBookingId}/status`, { Authorization: adminToken }, { status: 'confirmed' });
    assert(res.status === 400, 'Admin cannot confirm a cancelled booking (returns 400)');

    // Released date can now be booked by another customer
    res = await request('POST', '/api/bookings', { Authorization: customer2Token }, { date: validDateStr, size: 75, address: '888 New Horizon Blvd' });
    assert(res.status === 201, 'Released date can now be booked by another customer (returns 201 Created)');

    // ========================================================================
    // 4. Custom Pottery Requests (Complete 18 Test Cases)
    // ========================================================================
    console.log('\n[5] Testing Custom Pottery Requests:');

    // 17. Unauthenticated request to /api/pottery -> 401
    res = await request('GET', '/api/pottery');
    assert(res.status === 401, 'Unauthenticated GET /api/pottery returns 401');

    res = await request('POST', '/api/pottery', {}, { itemId: 'i-01', glazeId: 'g-01', quantity: 2, neededBy: '2026-12-01' });
    assert(res.status === 401, 'Unauthenticated POST /api/pottery returns 401');

    // 18. Wrong role: Admin cannot create pottery request -> 403
    res = await request('POST', '/api/pottery', { Authorization: adminToken }, { itemId: 'i-01', glazeId: 'g-01', quantity: 2, neededBy: '2026-12-01' });
    assert(res.status === 403, 'Admin cannot create pottery request (returns 403 Forbidden)');

    // Pottery dates setup
    const validPotteryDate = new Date();
    validPotteryDate.setDate(validPotteryDate.getDate() + 20);
    const validPotteryDateStr = validPotteryDate.toISOString().split('T')[0];

    const invalidNearPotteryDate = new Date();
    invalidNearPotteryDate.setDate(invalidNearPotteryDate.getDate() + 5);
    const invalidNearPotteryDateStr = invalidNearPotteryDate.toISOString().split('T')[0];

    // 2. Invalid item is rejected -> 400
    res = await request('POST', '/api/pottery', { Authorization: customerToken }, { itemId: 'invalid-item-999', glazeId: 'g-01', quantity: 4, neededBy: validPotteryDateStr });
    assert(res.status === 400, 'Invalid pottery item rejected with 400');

    // 3. Invalid glaze is rejected -> 400
    res = await request('POST', '/api/pottery', { Authorization: customerToken }, { itemId: 'i-01', glazeId: 'invalid-glaze-999', quantity: 4, neededBy: validPotteryDateStr });
    assert(res.status === 400, 'Invalid glaze rejected with 400');

    // 4. Quantity below 1 is rejected -> 400
    res = await request('POST', '/api/pottery', { Authorization: customerToken }, { itemId: 'i-01', glazeId: 'g-01', quantity: 0, neededBy: validPotteryDateStr });
    assert(res.status === 400, 'Quantity below 1 rejected with 400');

    // 5. Quantity above 12 is rejected -> 400
    res = await request('POST', '/api/pottery', { Authorization: customerToken }, { itemId: 'i-01', glazeId: 'g-01', quantity: 15, neededBy: validPotteryDateStr });
    assert(res.status === 400, 'Quantity above 12 rejected with 400');

    // 6. Needed-by date less than 14 days away is rejected -> 400
    res = await request('POST', '/api/pottery', { Authorization: customerToken }, { itemId: 'i-01', glazeId: 'g-01', quantity: 4, neededBy: invalidNearPotteryDateStr });
    assert(res.status === 400, 'Needed-by date < 14 days away rejected with 400');

    // 1. Customer can create valid pottery request -> 201
    res = await request('POST', '/api/pottery', { Authorization: customerToken }, { itemId: 'i-01', glazeId: 'g-04', quantity: 6, neededBy: validPotteryDateStr });
    assert(res.status === 201, 'Customer can create valid pottery request (returns 201 Created)');
    assert(res.body.request && res.body.request.status === 'requested', 'Created request status is "requested"');
    const customerPotteryId = res.body.request._id;

    // Customer 2 creates a pottery request
    res = await request('POST', '/api/pottery', { Authorization: customer2Token }, { itemId: 'i-02', glazeId: 'g-02', quantity: 2, neededBy: validPotteryDateStr });
    assert(res.status === 201, 'Customer 2 can create pottery request (returns 201)');
    const customer2PotteryId = res.body.request._id;

    // 7. Customer can view their own requests (only customer's requests)
    res = await request('GET', '/api/pottery', { Authorization: customerToken });
    assert(res.status === 200, 'Customer can GET /api/pottery (returns 200)');
    assert(Array.isArray(res.body), 'Response is an array');
    const customerHasCustomer2Request = res.body.some((r) => r._id.toString() === customer2PotteryId.toString());
    assert(!customerHasCustomer2Request, "Customer only receives their own pottery requests, not other customer's");

    // 8. Admin can view all requests
    res = await request('GET', '/api/pottery', { Authorization: adminToken });
    assert(res.status === 200, 'Admin can GET /api/pottery (returns 200)');
    const adminHasCust1 = res.body.some((r) => r._id.toString() === customerPotteryId.toString());
    const adminHasCust2 = res.body.some((r) => r._id.toString() === customer2PotteryId.toString());
    assert(adminHasCust1 && adminHasCust2, 'Admin receives all requests across all customers');

    // 9. Customer cannot access another customer's request -> 404 Not Found
    res = await request('GET', `/api/pottery/${customer2PotteryId}`, { Authorization: customerToken });
    assert(res.status === 404, "Customer accessing another customer's pottery request returns 404 Not Found");

    res = await request('GET', `/api/pottery/${customerPotteryId}`, { Authorization: customerToken });
    assert(res.status === 200, 'Customer accessing own pottery request returns 200 OK');

    // 10. Customer can edit a requested request
    const updatedPotteryDate = new Date();
    updatedPotteryDate.setDate(updatedPotteryDate.getDate() + 25);
    const updatedPotteryDateStr = updatedPotteryDate.toISOString().split('T')[0];

    res = await request('PATCH', `/api/pottery/${customerPotteryId}`, { Authorization: customerToken }, {
      itemId: 'i-03',
      glazeId: 'g-05',
      quantity: 8,
      neededBy: updatedPotteryDateStr,
    });
    assert(res.status === 200, 'Customer can edit requested pottery request (returns 200 OK)');
    assert(res.body.request.itemId === 'i-03' && res.body.request.quantity === 8, 'Request fields updated properly');

    // 16. Customer cannot accept/decline requests -> 403 Forbidden
    res = await request('PATCH', `/api/pottery/${customerPotteryId}/status`, { Authorization: customerToken }, { status: 'accepted' });
    assert(res.status === 403, 'Customer cannot update pottery request status (returns 403 Forbidden)');

    // 14. Admin can accept a requested request -> 200
    res = await request('PATCH', `/api/pottery/${customerPotteryId}/status`, { Authorization: adminToken }, { status: 'accepted' });
    assert(res.status === 200, 'Admin can accept requested request (returns 200 OK)');
    assert(res.body.request.status === 'accepted', 'Request status transitioned to "accepted"');

    // 11. Customer cannot edit an accepted request -> 400
    res = await request('PATCH', `/api/pottery/${customerPotteryId}`, { Authorization: customerToken }, { quantity: 10 });
    assert(res.status === 400, 'Customer cannot edit an accepted request (returns 400 Bad Request)');
    assert(res.body.error && res.body.error.includes('accepted'), 'Clear error stating request already accepted');

    // 13. Customer cannot cancel an accepted request -> 400
    res = await request('PATCH', `/api/pottery/${customerPotteryId}/cancel`, { Authorization: customerToken });
    assert(res.status === 400, 'Customer cannot cancel an accepted request (returns 400 Bad Request)');

    // 12. Customer can cancel a requested request (using customer 2's request)
    res = await request('PATCH', `/api/pottery/${customer2PotteryId}/cancel`, { Authorization: customer2Token });
    assert(res.status === 200, 'Customer can cancel a requested request (returns 200 OK)');
    assert(res.body.request.status === 'cancelled', 'Request status transitioned to "cancelled"');

    // 15. Admin can decline a requested request
    res = await request('POST', '/api/pottery', { Authorization: customerToken }, { itemId: 'i-04', glazeId: 'g-06', quantity: 3, neededBy: validPotteryDateStr });
    const declineTestId = res.body.request._id;

    res = await request('PATCH', `/api/pottery/${declineTestId}/status`, { Authorization: adminToken }, { status: 'declined' });
    assert(res.status === 200, 'Admin can decline requested request (returns 200 OK)');
    assert(res.body.request.status === 'declined', 'Request status transitioned to "declined"');

    // Admin cannot re-modify an already declined request -> 400
    res = await request('PATCH', `/api/pottery/${declineTestId}/status`, { Authorization: adminToken }, { status: 'accepted' });
    assert(res.status === 400, 'Admin cannot re-modify an already declined request (returns 400)');

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉\n');
  } catch (e) {
    console.error('Test suite encountered an error:', e);
    process.exitCode = 1;
  } finally {
    if (server) server.close();
    process.exit(process.exitCode || 0);
  }
}

runTests();
