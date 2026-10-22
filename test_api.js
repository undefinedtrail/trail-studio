// test_api.js - Automated API & RBAC test runner for Trail Studio
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
  console.log('--- Starting Trail Studio API & RBAC Test Suite ---');
  await connectDB();
  await seedDefaults();

  // Reset test artifacts so the suite is fully idempotent across multiple runs
  await Booking.deleteMany({});
  await Order.deleteMany({});
  await PotteryRequest.deleteMany({});
  await Painting.updateMany({}, { isAvailable: true });

  server = app.listen(PORT);
  console.log(`Test server running on port ${PORT}`);

  try {
    // ========================================================================
    // 1. Authentication Middleware
    // ========================================================================
    console.log('\n[1] Testing Authentication Middleware:');
    let res = await request('GET', '/api/paintings');
    assert(res.status === 401, 'Unauthenticated request to /api/paintings returns 401');

    res = await request('GET', '/api/auth/users');
    assert(res.status === 200, 'GET /api/auth/users returns 200');
    const studioUser = res.body.find((u) => u.role === 'studio' || u.role === 'admin');
    const customerUser = res.body.find((u) => u.email === 'alice@example.com');
    const otherCustomer = res.body.find((u) => u.email === 'bob@example.com');
    assert(!!studioUser, 'Studio user exists (studio@artstudio.in)');
    assert(!!customerUser, 'Customer user Alice exists (alice@example.com)');
    assert(!!otherCustomer, 'Customer user Bob exists (bob@example.com)');

    // ========================================================================
    // 2. Paintings Browsing, Creation, Editing & Concurrency
    // ========================================================================
    console.log('\n[2] Testing Paintings Browsing & RBAC:');
    res = await request('GET', '/api/paintings', { 'x-user-email': customerUser.email });
    assert(res.status === 200, 'Customer can browse paintings');
    assert(Array.isArray(res.body) && res.body.length >= 10, 'Found official seed paintings in DB');
    const targetPainting = res.body.find((p) => p.isAvailable);
    assert(!!targetPainting, 'Found at least one available painting to test buy');

    // Customer cannot add painting -> 403
    res = await request(
      'POST',
      '/api/paintings',
      { 'x-user-email': customerUser.email },
      { title: 'Unauthorized Art', price: 9999 }
    );
    assert(res.status === 403, 'Customer cannot add painting (returns 403 Forbidden)');

    // Studio adds a painting -> 201
    res = await request(
      'POST',
      '/api/paintings',
      { 'x-user-email': studioUser.email },
      { title: 'Bhil Art Deer Sanctuary', artist: 'Lado Bai', price: 9500, description: 'Traditional Bhil dot-pattern painting' }
    );
    assert(res.status === 201, 'Studio can add painting (returns 201 Created)');
    const newlyAddedPainting = res.body.painting;

    // Studio edits painting while available -> 200
    res = await request(
      'PATCH',
      `/api/paintings/${newlyAddedPainting._id}`,
      { 'x-user-email': studioUser.email },
      { price: 10500, description: 'Updated: Traditional Bhil dot-pattern painting on canvas' }
    );
    assert(res.status === 200, 'Studio can edit painting while available (returns 200)');
    assert(res.body.painting.price === 10500, 'Painting price updated successfully');

    // Customer cannot edit painting -> 403
    res = await request(
      'PATCH',
      `/api/paintings/${newlyAddedPainting._id}`,
      { 'x-user-email': customerUser.email },
      { price: 5000 }
    );
    assert(res.status === 403, 'Customer cannot edit painting (returns 403 Forbidden)');

    // Studio cannot buy paintings -> 403
    res = await request('POST', `/api/paintings/${newlyAddedPainting._id}/buy`, {
      'x-user-email': studioUser.email,
    });
    assert(res.status === 403, 'Studio cannot buy paintings (returns 403 Forbidden)');

    // Customer buys painting -> 201
    console.log('\n[3] Testing Painting Purchase & Concurrency:');
    res = await request('POST', `/api/paintings/${newlyAddedPainting._id}/buy`, {
      'x-user-email': customerUser.email,
    });
    assert(res.status === 201, 'Customer successfully bought painting (returns 201)');
    assert(res.body.painting.isAvailable === false, 'Painting isAvailable set to false');
    const orderId = res.body.order._id;

    // Concurrency / second purchase attempt is refused
    res = await request('POST', `/api/paintings/${newlyAddedPainting._id}/buy`, {
      'x-user-email': otherCustomer.email,
    });
    assert(res.status === 400, 'Second attempt to buy same painting is refused with 400');
    assert(
      res.body && res.body.error && res.body.error.toLowerCase().includes('sold'),
      'Clear refusal message: painting already sold'
    );

    // Studio cannot edit painting after it is sold -> 400
    res = await request(
      'PATCH',
      `/api/paintings/${newlyAddedPainting._id}`,
      { 'x-user-email': studioUser.email },
      { price: 12000 }
    );
    assert(res.status === 400, 'Studio cannot edit painting after it is sold (returns 400)');

    // ========================================================================
    // 3. Wall Painting Bookings
    // ========================================================================
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

    // Valid booking creation
    res = await request(
      'POST',
      '/api/bookings',
      { 'x-user-email': customerUser.email },
      { date: validDateStr, size: 100, address: '45 Heritage Colony, Jaipur' }
    );
    assert(res.status === 201, 'Valid wall booking created (returns 201)');
    assert(res.body.booking.price === 15000, 'Price calculated correctly with seedData rate (100 * 150 = 15000)');
    const aliceBookingId = res.body.booking._id;

    // Double-booking check: same date from Bob is rejected
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

    // Privacy check on booking (404)
    res = await request('GET', `/api/bookings/${aliceBookingId}`, {
      'x-user-email': otherCustomer.email,
    });
    assert(
      res.status === 404,
      "Customer viewing another customer's booking returns 404 Not Found"
    );

    // Studio confirms booking
    res = await request(
      'PATCH',
      `/api/bookings/${aliceBookingId}/status`,
      { 'x-user-email': studioUser.email },
      { status: 'confirmed' }
    );
    assert(res.status === 200, 'Studio confirmed booking (returns 200 OK)');
    assert(res.body.booking.status === 'confirmed', 'Booking status is now "confirmed"');

    // Customer cancels order -> Painting becomes available again
    res = await request('PATCH', `/api/orders/${orderId}/cancel`, {
      'x-user-email': customerUser.email,
    });
    assert(res.status === 200, 'Customer cancelled order (returns 200 OK)');

    const paintingCheck = await Painting.findById(newlyAddedPainting._id);
    assert(
      paintingCheck.isAvailable === true,
      'Painting is available again after customer cancelled order'
    );

    // Customer cancels booking -> Date released
    res = await request('PATCH', `/api/bookings/${aliceBookingId}/cancel`, {
      'x-user-email': customerUser.email,
    });
    assert(res.status === 200, 'Customer cancelled booking (returns 200 OK)');

    // ========================================================================
    // 4. Custom Pottery Requests (Comprehensive 18 Test Cases)
    // ========================================================================
    console.log('\n[5] Testing Custom Pottery Requests:');

    // 17. Unauthenticated request to /api/pottery -> 401
    res = await request('GET', '/api/pottery');
    assert(res.status === 401, 'Unauthenticated GET /api/pottery returns 401');

    res = await request('POST', '/api/pottery', {}, { itemId: 'i-01', glazeId: 'g-01', quantity: 2, neededBy: '2026-12-01' });
    assert(res.status === 401, 'Unauthenticated POST /api/pottery returns 401');

    // 18. Wrong role: Studio cannot create pottery request -> 403
    res = await request(
      'POST',
      '/api/pottery',
      { 'x-user-email': studioUser.email },
      { itemId: 'i-01', glazeId: 'g-01', quantity: 2, neededBy: '2026-12-01' }
    );
    assert(res.status === 403, 'Studio cannot create pottery request (returns 403 Forbidden)');

    // Pottery date setup: needed-by at least 14 days away
    const validPotteryDate = new Date();
    validPotteryDate.setDate(validPotteryDate.getDate() + 20);
    const validPotteryDateStr = validPotteryDate.toISOString().split('T')[0];

    const invalidNearPotteryDate = new Date();
    invalidNearPotteryDate.setDate(invalidNearPotteryDate.getDate() + 5);
    const invalidNearPotteryDateStr = invalidNearPotteryDate.toISOString().split('T')[0];

    // 2. Invalid item is rejected -> 400
    res = await request(
      'POST',
      '/api/pottery',
      { 'x-user-email': customerUser.email },
      { itemId: 'invalid-item-999', glazeId: 'g-01', quantity: 4, neededBy: validPotteryDateStr }
    );
    assert(res.status === 400, 'Invalid pottery item rejected with 400');

    // 3. Invalid glaze is rejected -> 400
    res = await request(
      'POST',
      '/api/pottery',
      { 'x-user-email': customerUser.email },
      { itemId: 'i-01', glazeId: 'invalid-glaze-999', quantity: 4, neededBy: validPotteryDateStr }
    );
    assert(res.status === 400, 'Invalid glaze rejected with 400');

    // 4. Quantity below 1 is rejected -> 400
    res = await request(
      'POST',
      '/api/pottery',
      { 'x-user-email': customerUser.email },
      { itemId: 'i-01', glazeId: 'g-01', quantity: 0, neededBy: validPotteryDateStr }
    );
    assert(res.status === 400, 'Quantity below 1 rejected with 400');

    // 5. Quantity above 12 is rejected -> 400
    res = await request(
      'POST',
      '/api/pottery',
      { 'x-user-email': customerUser.email },
      { itemId: 'i-01', glazeId: 'g-01', quantity: 15, neededBy: validPotteryDateStr }
    );
    assert(res.status === 400, 'Quantity above 12 rejected with 400');

    // 6. Needed-by date less than 14 days away is rejected -> 400
    res = await request(
      'POST',
      '/api/pottery',
      { 'x-user-email': customerUser.email },
      { itemId: 'i-01', glazeId: 'g-01', quantity: 4, neededBy: invalidNearPotteryDateStr }
    );
    assert(res.status === 400, 'Needed-by date < 14 days away rejected with 400');

    // 1. Customer can create valid pottery request -> 201
    res = await request(
      'POST',
      '/api/pottery',
      { 'x-user-email': customerUser.email },
      { itemId: 'i-01', glazeId: 'g-04', quantity: 6, neededBy: validPotteryDateStr }
    );
    assert(res.status === 201, 'Customer can create valid pottery request (returns 201 Created)');
    assert(res.body.request && res.body.request.status === 'requested', 'Created request status is "requested"');
    const alicePotteryId = res.body.request._id;

    // Create a second request from Bob
    res = await request(
      'POST',
      '/api/pottery',
      { 'x-user-email': otherCustomer.email },
      { itemId: 'i-02', glazeId: 'g-02', quantity: 2, neededBy: validPotteryDateStr }
    );
    assert(res.status === 201, 'Bob can create pottery request (returns 201)');
    const bobPotteryId = res.body.request._id;

    // 7. Customer can view their own requests (only Alice's requests)
    res = await request('GET', '/api/pottery', { 'x-user-email': customerUser.email });
    assert(res.status === 200, 'Customer can GET /api/pottery (returns 200)');
    assert(Array.isArray(res.body), 'Response is an array');
    const aliceHasBobRequest = res.body.some((r) => r._id.toString() === bobPotteryId.toString());
    assert(!aliceHasBobRequest, 'Customer only receives their own pottery requests, not Bob’s');

    // 8. Studio can view all requests
    res = await request('GET', '/api/pottery', { 'x-user-email': studioUser.email });
    assert(res.status === 200, 'Studio can GET /api/pottery (returns 200)');
    const studioHasAlice = res.body.some((r) => r._id.toString() === alicePotteryId.toString());
    const studioHasBob = res.body.some((r) => r._id.toString() === bobPotteryId.toString());
    assert(studioHasAlice && studioHasBob, 'Studio receives all requests across all customers');

    // 9. Customer cannot access another customer's request -> 404 Not Found
    res = await request('GET', `/api/pottery/${bobPotteryId}`, { 'x-user-email': customerUser.email });
    assert(res.status === 404, "Customer accessing another customer's pottery request returns 404 Not Found");

    res = await request('GET', `/api/pottery/${alicePotteryId}`, { 'x-user-email': customerUser.email });
    assert(res.status === 200, 'Customer accessing own pottery request returns 200 OK');

    // 10. Customer can edit a requested request
    const updatedPotteryDate = new Date();
    updatedPotteryDate.setDate(updatedPotteryDate.getDate() + 25);
    const updatedPotteryDateStr = updatedPotteryDate.toISOString().split('T')[0];

    res = await request(
      'PATCH',
      `/api/pottery/${alicePotteryId}`,
      { 'x-user-email': customerUser.email },
      { itemId: 'i-03', glazeId: 'g-05', quantity: 8, neededBy: updatedPotteryDateStr }
    );
    assert(res.status === 200, 'Customer can edit requested pottery request (returns 200 OK)');
    assert(res.body.request.itemId === 'i-03' && res.body.request.quantity === 8, 'Request fields updated properly');

    // 16. Customer cannot accept/decline requests -> 403 Forbidden
    res = await request(
      'PATCH',
      `/api/pottery/${alicePotteryId}/status`,
      { 'x-user-email': customerUser.email },
      { status: 'accepted' }
    );
    assert(res.status === 403, 'Customer cannot update pottery request status (returns 403 Forbidden)');

    // 14. Studio can accept a requested request -> 200
    res = await request(
      'PATCH',
      `/api/pottery/${alicePotteryId}/status`,
      { 'x-user-email': studioUser.email },
      { status: 'accepted' }
    );
    assert(res.status === 200, 'Studio can accept requested request (returns 200 OK)');
    assert(res.body.request.status === 'accepted', 'Request status transitioned to "accepted"');

    // 11. Customer cannot edit an accepted request -> 400
    res = await request(
      'PATCH',
      `/api/pottery/${alicePotteryId}`,
      { 'x-user-email': customerUser.email },
      { quantity: 10 }
    );
    assert(res.status === 400, 'Customer cannot edit an accepted request (returns 400 Bad Request)');
    assert(res.body.error && res.body.error.includes('accepted'), 'Clear error stating request already accepted');

    // 13. Customer cannot cancel an accepted request -> 400
    res = await request(
      'PATCH',
      `/api/pottery/${alicePotteryId}/cancel`,
      { 'x-user-email': customerUser.email }
    );
    assert(res.status === 400, 'Customer cannot cancel an accepted request (returns 400 Bad Request)');

    // 12. Customer can cancel a requested request (using Bob's request)
    res = await request(
      'PATCH',
      `/api/pottery/${bobPotteryId}/cancel`,
      { 'x-user-email': otherCustomer.email }
    );
    assert(res.status === 200, 'Customer can cancel a requested request (returns 200 OK)');
    assert(res.body.request.status === 'cancelled', 'Request status transitioned to "cancelled"');

    // 15. Studio can decline a requested request
    // First create a new request for testing decline
    res = await request(
      'POST',
      '/api/pottery',
      { 'x-user-email': customerUser.email },
      { itemId: 'i-04', glazeId: 'g-06', quantity: 3, neededBy: validPotteryDateStr }
    );
    const declineTestId = res.body.request._id;

    res = await request(
      'PATCH',
      `/api/pottery/${declineTestId}/status`,
      { 'x-user-email': studioUser.email },
      { status: 'declined' }
    );
    assert(res.status === 200, 'Studio can decline requested request (returns 200 OK)');
    assert(res.body.request.status === 'declined', 'Request status transitioned to "declined"');

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
