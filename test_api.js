// test_api.js - Automated API & RBAC test runner for Trail Studio
require('dotenv').config();
const http = require('http');
const { app } = require('./server');
const { connectDB, seedDefaults, User, Painting, Booking, Order } = require('./models/db');

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
  console.log('--- Starting Trail Studio API & RBAC Test Suite ---');
  await connectDB();
  await seedDefaults();

  // Reset test artifacts so the suite is fully idempotent across multiple runs
  await Booking.deleteMany({});
  await Order.deleteMany({});
  await Painting.updateMany({}, { isAvailable: true });

  server = app.listen(PORT);
  console.log(`Test server running on port ${PORT}`);

  try {
    // 1. Unauthenticated Request -> 401 Unauthorized
    console.log('\n[1] Testing Authentication Middleware:');
    let res = await request('GET', '/api/paintings');
    assert(res.status === 401, 'Unauthenticated request to /api/paintings returns 401');

    // 2. Fetch users to verify seeded accounts
    res = await request('GET', '/api/auth/users');
    assert(res.status === 200, 'GET /api/auth/users returns 200');
    const studioUser = res.body.find((u) => u.role === 'studio' || u.role === 'admin');
    const customerUser = res.body.find((u) => u.email === 'alice@example.com');
    const otherCustomer = res.body.find((u) => u.email === 'bob@example.com');
    assert(!!studioUser, 'Studio user exists (studio@artstudio.in)');
    assert(!!customerUser, 'Customer user Alice exists (alice@example.com)');
    assert(!!otherCustomer, 'Customer user Bob exists (bob@example.com)');

    // 3. Browse paintings with customer credentials
    console.log('\n[2] Testing Paintings Browsing & RBAC:');
    res = await request('GET', '/api/paintings', { 'x-user-email': customerUser.email });
    assert(res.status === 200, 'Customer can browse paintings');
    assert(Array.isArray(res.body) && res.body.length >= 10, 'Found official seed paintings in DB');
    const targetPainting = res.body.find((p) => p.isAvailable);
    assert(!!targetPainting, 'Found at least one available painting to test buy');

    // 4. Customer tries to add painting -> 403 Forbidden
    res = await request(
      'POST',
      '/api/paintings',
      { 'x-user-email': customerUser.email },
      { title: 'Unauthorized Art', price: 9999 }
    );
    assert(res.status === 403, 'Customer cannot add painting (returns 403 Forbidden)');

    // 5. Studio adds a painting -> 201 Created
    res = await request(
      'POST',
      '/api/paintings',
      { 'x-user-email': studioUser.email },
      { title: 'Bhil Art Deer Sanctuary', artist: 'Lado Bai', price: 9500, description: 'Traditional Bhil dot-pattern painting' }
    );
    assert(res.status === 201, 'Studio can add painting (returns 201 Created)');
    const newlyAddedPainting = res.body.painting;

    // 6. Studio tries to buy painting -> 403 Forbidden
    res = await request('POST', `/api/paintings/${newlyAddedPainting._id}/buy`, {
      'x-user-email': studioUser.email,
    });
    assert(res.status === 403, 'Studio cannot buy paintings (returns 403 Forbidden)');

    // 7. Customer buys the painting -> 201 Created, isAvailable becomes false
    console.log('\n[3] Testing Painting Purchase & Concurrency:');
    res = await request('POST', `/api/paintings/${newlyAddedPainting._id}/buy`, {
      'x-user-email': customerUser.email,
    });
    assert(res.status === 201, 'Customer successfully bought painting (returns 201)');
    assert(res.body.painting.isAvailable === false, 'Painting isAvailable set to false');
    const orderId = res.body.order._id;

    // 8. Second purchase attempt on the same painting -> Refusal (400)
    res = await request('POST', `/api/paintings/${newlyAddedPainting._id}/buy`, {
      'x-user-email': otherCustomer.email,
    });
    assert(res.status === 400, 'Second attempt to buy same painting is refused with 400');
    assert(
      res.body && res.body.error && res.body.error.toLowerCase().includes('sold'),
      'Clear refusal message: painting already sold'
    );

    // 9. Wall Booking Validations
    console.log('\n[4] Testing Wall Bookings:');
    const nearDate = new Date();
    nearDate.setDate(nearDate.getDate() + 2);
    const nearDateStr = nearDate.toISOString().split('T')[0];

    res = await request(
      'POST',
      '/api/bookings',
      { 'x-user-email': customerUser.email },
      { date: nearDateStr, size: 50, address: '45 Heritage Colony' }
    );
    assert(res.status === 400, 'Booking date < 7 days is rejected (returns 400)');

    const validDate = new Date();
    validDate.setDate(validDate.getDate() + 15);
    const validDateStr = validDate.toISOString().split('T')[0];

    res = await request(
      'POST',
      '/api/bookings',
      { 'x-user-email': customerUser.email },
      { date: validDateStr, size: 5, address: '45 Heritage Colony' }
    );
    assert(res.status === 400, 'Wall size < 10 sq ft rejected (returns 400)');

    res = await request(
      'POST',
      '/api/bookings',
      { 'x-user-email': customerUser.email },
      { date: validDateStr, size: 600, address: '45 Heritage Colony' }
    );
    assert(res.status === 400, 'Wall size > 500 sq ft rejected (returns 400)');

    // Successful booking: 100 sq ft * 150 = 15000
    res = await request(
      'POST',
      '/api/bookings',
      { 'x-user-email': customerUser.email },
      { date: validDateStr, size: 100, address: '45 Heritage Colony, Jaipur' }
    );
    assert(res.status === 201, 'Valid wall booking created (returns 201)');
    assert(res.body.booking.price === 15000, 'Price calculated correctly with seedData rate (100 * 150 = 15000)');
    const aliceBookingId = res.body.booking._id;

    // Double-booking check: same date from Bob
    res = await request(
      'POST',
      '/api/bookings',
      { 'x-user-email': otherCustomer.email },
      { date: validDateStr, size: 50, address: '99 Civil Lines' }
    );
    assert(res.status === 409, 'Double booking same date is rejected (returns 409 Conflict)');
    assert(
      res.body.error && res.body.error.includes('already been booked'),
      'Clear refusal message: date already booked'
    );

    // 10. Customer Privacy & Ownership Check:
    console.log('\n[5] Testing Ownership Protection (404 on other customer record):');
    res = await request('GET', `/api/bookings/${aliceBookingId}`, {
      'x-user-email': otherCustomer.email,
    });
    assert(
      res.status === 404,
      "Customer viewing another customer's booking returns 404 Not Found (enforces privacy)"
    );

    res = await request('GET', `/api/bookings/${aliceBookingId}`, {
      'x-user-email': customerUser.email,
    });
    assert(res.status === 200, 'Customer viewing own booking returns 200 OK');

    res = await request('GET', `/api/bookings/${aliceBookingId}`, {
      'x-user-email': studioUser.email,
    });
    assert(res.status === 200, "Studio can view customer's booking");

    // 11. Studio confirms booking
    console.log('\n[6] Testing Studio Booking Status Update:');
    res = await request(
      'PATCH',
      `/api/bookings/${aliceBookingId}/status`,
      { 'x-user-email': customerUser.email },
      { status: 'confirmed' }
    );
    assert(res.status === 403, 'Customer cannot confirm booking (returns 403 Forbidden)');

    res = await request(
      'PATCH',
      `/api/bookings/${aliceBookingId}/status`,
      { 'x-user-email': studioUser.email },
      { status: 'confirmed' }
    );
    assert(res.status === 200, 'Studio confirmed booking (returns 200 OK)');
    assert(res.body.booking.status === 'confirmed', 'Booking status is now "confirmed"');

    // 12. Customer cancels order -> Painting becomes available again!
    console.log('\n[7] Testing Order Cancellation & Painting Re-availability:');
    res = await request('PATCH', `/api/orders/${orderId}/cancel`, {
      'x-user-email': customerUser.email,
    });
    assert(res.status === 200, 'Customer cancelled order (returns 200 OK)');

    const paintingCheck = await Painting.findById(newlyAddedPainting._id);
    assert(
      paintingCheck.isAvailable === true,
      'Painting is available again after customer cancelled order'
    );

    // 13. Customer cancels booking (15 days away, so > 3 days) -> date is released
    console.log('\n[8] Testing Booking Cancellation:');
    res = await request('PATCH', `/api/bookings/${aliceBookingId}/cancel`, {
      'x-user-email': customerUser.email,
    });
    assert(res.status === 200, 'Customer cancelled booking (returns 200 OK)');
    assert(res.body.booking.status === 'cancelled', 'Booking status is cancelled');

    res = await request(
      'POST',
      '/api/bookings',
      { 'x-user-email': otherCustomer.email },
      { date: validDateStr, size: 75, address: '888 New Horizon Blvd' }
    );
    assert(
      res.status === 201,
      'Released date can now be booked by another customer (returns 201 Created)'
    );

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
