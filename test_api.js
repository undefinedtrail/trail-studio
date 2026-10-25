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
  await seedDefaults();

  // Reset test artifacts in the isolated test database
  await User.deleteMany({ email: { $nin: ['studio@artstudio.in', 'alice@example.com', 'bob@example.com'] } });
  await Booking.deleteMany({});
  await Order.deleteMany({});
  await PotteryRequest.deleteMany({});
  await Painting.updateMany({}, { isAvailable: true });

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
    res = await request('POST', '/api/auth/login', {}, { email: 'studio@artstudio.in', password: 'WrongPassword' });
    assert(res.status === 401, 'Login with incorrect password returns 401');

    // Login with seeded Studio credentials
    res = await request('POST', '/api/auth/login', {}, { email: 'studio@artstudio.in', password: 'Studio@123' });
    assert(res.status === 200, 'Studio login successful (200)');
    assert(res.body.token && (res.body.user.role === 'studio' || res.body.user.role === 'admin'), 'Studio receives signed token with studio role');
    const studioToken = `Bearer ${res.body.token}`;

    // Login with seeded Alice customer credentials
    res = await request('POST', '/api/auth/login', {}, { email: 'alice@example.com', password: 'Customer@123' });
    assert(res.status === 200, 'Alice login successful (200)');
    assert(res.body.token && res.body.user.role === 'customer', 'Customer receives signed token with customer role');
    const aliceToken = `Bearer ${res.body.token}`;

    // Login with seeded Bob customer credentials
    res = await request('POST', '/api/auth/login', {}, { email: 'bob@example.com', password: 'Customer@123' });
    assert(res.status === 200, 'Bob login successful (200)');
    const bobToken = `Bearer ${res.body.token}`;

    // Customer Registration: Role must be strictly 'customer'
    res = await request('POST', '/api/auth/register', {}, { email: 'newbie@example.com', password: 'Password123', role: 'studio' });
    assert(res.status === 201, 'Customer registration successful (201)');
    assert(res.body.user.role === 'customer', 'Registration strictly forces customer role even if studio role was requested');

    // Duplicate email registration is rejected
    res = await request('POST', '/api/auth/register', {}, { email: 'newbie@example.com', password: 'Password123' });
    assert(res.status === 400, 'Duplicate email registration rejected with 400');

    // GET /api/auth/me returns authenticated user
    res = await request('GET', '/api/auth/me', { Authorization: aliceToken });
    assert(res.status === 200 && res.body.user.email === 'alice@example.com', 'GET /api/auth/me returns authenticated user profile');

    // Quick user switcher endpoint returns valid token
    res = await request('POST', '/api/auth/switch', {}, { email: 'studio@artstudio.in' });
    assert(res.status === 200, 'POST /api/auth/switch returns 200 OK');
    assert(res.body.token && (res.body.user.role === 'studio' || res.body.user.role === 'admin'), 'Switched user receives valid token and studio role');

    // ========================================================================
    // 2. Paintings Browsing, Creation, Editing & Purchase Concurrency
    // ========================================================================
    console.log('\n[2] Testing Paintings Browsing & RBAC:');

    // Customer can browse paintings
    res = await request('GET', '/api/paintings', { Authorization: aliceToken });
    assert(res.status === 200 && Array.isArray(res.body) && res.body.length >= 10, 'Customer can browse catalog paintings');
    const targetPainting = res.body.find((p) => p.isAvailable);
    assert(!!targetPainting, 'Found available painting in catalog');

    // Customer cannot add painting -> 403
    res = await request('POST', '/api/paintings', { Authorization: aliceToken }, { title: 'Unauthorized Art', price: 9999 });
    assert(res.status === 403, 'Customer cannot add painting (returns 403 Forbidden)');

    // Studio adds a painting -> 201
    res = await request('POST', '/api/paintings', { Authorization: studioToken }, {
      title: 'Bhil Art Deer Sanctuary',
      artist: 'Lado Bai',
      price: 9500,
      description: 'Traditional Bhil dot-pattern painting',
    });
    assert(res.status === 201, 'Studio can add painting (returns 201 Created)');
    const newlyAddedPainting = res.body.painting;

    // Studio edits painting while available -> 200
    res = await request('PATCH', `/api/paintings/${newlyAddedPainting._id}`, { Authorization: studioToken }, {
      price: 10500,
      description: 'Updated: Traditional Bhil dot-pattern painting on canvas',
    });
    assert(res.status === 200, 'Studio can edit painting while available (returns 200)');
    assert(res.body.painting.price === 10500, 'Painting price updated successfully');

    // Customer cannot edit painting -> 403
    res = await request('PATCH', `/api/paintings/${newlyAddedPainting._id}`, { Authorization: aliceToken }, { price: 5000 });
    assert(res.status === 403, 'Customer cannot edit painting (returns 403 Forbidden)');

    // Studio cannot buy paintings -> 403
    res = await request('POST', `/api/paintings/${newlyAddedPainting._id}/buy`, { Authorization: studioToken });
    assert(res.status === 403, 'Studio cannot buy paintings (returns 403 Forbidden)');

    // Concurrency: Customer buys painting
    console.log('\n[3] Testing Painting Purchase Concurrency:');
    res = await request('POST', `/api/paintings/${newlyAddedPainting._id}/buy`, { Authorization: aliceToken });
    assert(res.status === 201, 'Customer successfully bought painting (returns 201)');
    assert(res.body.painting.isAvailable === false, 'Painting isAvailable set to false');
    const orderId = res.body.order._id;

    // Second simultaneous/competing buy attempt is refused with 400
    res = await request('POST', `/api/paintings/${newlyAddedPainting._id}/buy`, { Authorization: bobToken });
    assert(res.status === 400, 'Second attempt to buy same painting is refused with 400');
    assert(res.body && res.body.error && res.body.error.toLowerCase().includes('sold'), 'Clear refusal message: painting already sold');

    // Studio cannot edit painting after it is sold -> 400
    res = await request('PATCH', `/api/paintings/${newlyAddedPainting._id}`, { Authorization: studioToken }, { price: 12000 });
    assert(res.status === 400, 'Studio cannot edit painting after it is sold (returns 400)');

    // ========================================================================
    // 3. Wall Painting Bookings
    // ========================================================================
    console.log('\n[4] Testing Wall Bookings:');

    // Date boundary checks (< 7 days or > 90 days)
    const nearDate = new Date();
    nearDate.setDate(nearDate.getDate() + 2);
    const nearDateStr = nearDate.toISOString().split('T')[0];

    res = await request('POST', '/api/bookings', { Authorization: aliceToken }, { date: nearDateStr, size: 50, address: '45 Heritage Colony' });
    assert(res.status === 400, 'Booking date < 7 days is rejected (returns 400)');

    const farDate = new Date();
    farDate.setDate(farDate.getDate() + 95);
    const farDateStr = farDate.toISOString().split('T')[0];

    res = await request('POST', '/api/bookings', { Authorization: aliceToken }, { date: farDateStr, size: 50, address: '45 Heritage Colony' });
    assert(res.status === 400, 'Booking date > 90 days is rejected (returns 400)');

    // Size boundary checks (< 10, > 500, NaN)
    const validDate = new Date();
    validDate.setDate(validDate.getDate() + 15);
    const validDateStr = validDate.toISOString().split('T')[0];

    res = await request('POST', '/api/bookings', { Authorization: aliceToken }, { date: validDateStr, size: 5, address: '45 Heritage Colony' });
    assert(res.status === 400, 'Wall size < 10 sq ft rejected (returns 400)');

    res = await request('POST', '/api/bookings', { Authorization: aliceToken }, { date: validDateStr, size: 600, address: '45 Heritage Colony' });
    assert(res.status === 400, 'Wall size > 500 sq ft rejected (returns 400)');

    res = await request('POST', '/api/bookings', { Authorization: aliceToken }, { date: validDateStr, size: 'not-a-number', address: '45 Heritage Colony' });
    assert(res.status === 400, 'Invalid non-numeric wall size rejected (returns 400)');

    // Valid booking creation: 100 sq ft * 150 = 15000
    res = await request('POST', '/api/bookings', { Authorization: aliceToken }, { date: validDateStr, size: 100, address: '45 Heritage Colony, Jaipur' });
    assert(res.status === 201, 'Valid wall booking created (returns 201)');
    assert(res.body.booking.price === 15000, 'Price calculated correctly with seed rate (100 * 150 = 15000)');
    const aliceBookingId = res.body.booking._id;

    // Double-booking conflict check: Bob attempts to book the same date -> 409
    res = await request('POST', '/api/bookings', { Authorization: bobToken }, { date: validDateStr, size: 50, address: '99 Civil Lines' });
    assert(res.status === 409, 'Double booking same date is rejected (returns 409 Conflict)');
    assert(res.body.error && res.body.error.includes('already been booked'), 'Clear refusal message: date already booked');

    // Customer privacy: Bob viewing Alice's booking returns 404 Not Found
    res = await request('GET', `/api/bookings/${aliceBookingId}`, { Authorization: bobToken });
    assert(res.status === 404, "Customer viewing another customer's booking returns 404 Not Found");

    // Studio confirms booking
    res = await request('PATCH', `/api/bookings/${aliceBookingId}/status`, { Authorization: studioToken }, { status: 'confirmed' });
    assert(res.status === 200, 'Studio confirmed booking (returns 200 OK)');
    assert(res.body.booking.status === 'confirmed', 'Booking status is now "confirmed"');

    // Studio cannot confirm an already confirmed booking -> 400
    res = await request('PATCH', `/api/bookings/${aliceBookingId}/status`, { Authorization: studioToken }, { status: 'confirmed' });
    assert(res.status === 400, 'Studio cannot re-confirm an already confirmed booking (returns 400)');

    // Customer cancels order -> Painting becomes available again
    res = await request('PATCH', `/api/orders/${orderId}/cancel`, { Authorization: aliceToken });
    assert(res.status === 200, 'Customer cancelled order (returns 200 OK)');

    const paintingCheck = await Painting.findById(newlyAddedPainting._id);
    assert(paintingCheck.isAvailable === true, 'Painting is available again after customer cancelled order');

    // Customer cannot duplicate-cancel already cancelled order -> 400
    res = await request('PATCH', `/api/orders/${orderId}/cancel`, { Authorization: aliceToken });
    assert(res.status === 400, 'Customer cannot cancel an already cancelled order (returns 400)');

    // Customer cancels booking -> Date released
    res = await request('PATCH', `/api/bookings/${aliceBookingId}/cancel`, { Authorization: aliceToken });
    assert(res.status === 200, 'Customer cancelled booking (returns 200 OK)');

    // Studio cannot confirm a cancelled booking -> 400
    res = await request('PATCH', `/api/bookings/${aliceBookingId}/status`, { Authorization: studioToken }, { status: 'confirmed' });
    assert(res.status === 400, 'Studio cannot confirm a cancelled booking (returns 400)');

    // Released date can now be booked by Bob
    res = await request('POST', '/api/bookings', { Authorization: bobToken }, { date: validDateStr, size: 75, address: '888 New Horizon Blvd' });
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

    // 18. Wrong role: Studio cannot create pottery request -> 403
    res = await request('POST', '/api/pottery', { Authorization: studioToken }, { itemId: 'i-01', glazeId: 'g-01', quantity: 2, neededBy: '2026-12-01' });
    assert(res.status === 403, 'Studio cannot create pottery request (returns 403 Forbidden)');

    // Pottery dates setup
    const validPotteryDate = new Date();
    validPotteryDate.setDate(validPotteryDate.getDate() + 20);
    const validPotteryDateStr = validPotteryDate.toISOString().split('T')[0];

    const invalidNearPotteryDate = new Date();
    invalidNearPotteryDate.setDate(invalidNearPotteryDate.getDate() + 5);
    const invalidNearPotteryDateStr = invalidNearPotteryDate.toISOString().split('T')[0];

    // 2. Invalid item is rejected -> 400
    res = await request('POST', '/api/pottery', { Authorization: aliceToken }, { itemId: 'invalid-item-999', glazeId: 'g-01', quantity: 4, neededBy: validPotteryDateStr });
    assert(res.status === 400, 'Invalid pottery item rejected with 400');

    // 3. Invalid glaze is rejected -> 400
    res = await request('POST', '/api/pottery', { Authorization: aliceToken }, { itemId: 'i-01', glazeId: 'invalid-glaze-999', quantity: 4, neededBy: validPotteryDateStr });
    assert(res.status === 400, 'Invalid glaze rejected with 400');

    // 4. Quantity below 1 is rejected -> 400
    res = await request('POST', '/api/pottery', { Authorization: aliceToken }, { itemId: 'i-01', glazeId: 'g-01', quantity: 0, neededBy: validPotteryDateStr });
    assert(res.status === 400, 'Quantity below 1 rejected with 400');

    // 5. Quantity above 12 is rejected -> 400
    res = await request('POST', '/api/pottery', { Authorization: aliceToken }, { itemId: 'i-01', glazeId: 'g-01', quantity: 15, neededBy: validPotteryDateStr });
    assert(res.status === 400, 'Quantity above 12 rejected with 400');

    // 6. Needed-by date less than 14 days away is rejected -> 400
    res = await request('POST', '/api/pottery', { Authorization: aliceToken }, { itemId: 'i-01', glazeId: 'g-01', quantity: 4, neededBy: invalidNearPotteryDateStr });
    assert(res.status === 400, 'Needed-by date < 14 days away rejected with 400');

    // 1. Customer can create valid pottery request -> 201
    res = await request('POST', '/api/pottery', { Authorization: aliceToken }, { itemId: 'i-01', glazeId: 'g-04', quantity: 6, neededBy: validPotteryDateStr });
    assert(res.status === 201, 'Customer can create valid pottery request (returns 201 Created)');
    assert(res.body.request && res.body.request.status === 'requested', 'Created request status is "requested"');
    const alicePotteryId = res.body.request._id;

    // Bob creates a pottery request
    res = await request('POST', '/api/pottery', { Authorization: bobToken }, { itemId: 'i-02', glazeId: 'g-02', quantity: 2, neededBy: validPotteryDateStr });
    assert(res.status === 201, 'Bob can create pottery request (returns 201)');
    const bobPotteryId = res.body.request._id;

    // 7. Customer can view their own requests (only Alice's requests)
    res = await request('GET', '/api/pottery', { Authorization: aliceToken });
    assert(res.status === 200, 'Customer can GET /api/pottery (returns 200)');
    assert(Array.isArray(res.body), 'Response is an array');
    const aliceHasBobRequest = res.body.some((r) => r._id.toString() === bobPotteryId.toString());
    assert(!aliceHasBobRequest, 'Customer only receives their own pottery requests, not Bob’s');

    // 8. Studio can view all requests
    res = await request('GET', '/api/pottery', { Authorization: studioToken });
    assert(res.status === 200, 'Studio can GET /api/pottery (returns 200)');
    const studioHasAlice = res.body.some((r) => r._id.toString() === alicePotteryId.toString());
    const studioHasBob = res.body.some((r) => r._id.toString() === bobPotteryId.toString());
    assert(studioHasAlice && studioHasBob, 'Studio receives all requests across all customers');

    // 9. Customer cannot access another customer's request -> 404 Not Found
    res = await request('GET', `/api/pottery/${bobPotteryId}`, { Authorization: aliceToken });
    assert(res.status === 404, "Customer accessing another customer's pottery request returns 404 Not Found");

    res = await request('GET', `/api/pottery/${alicePotteryId}`, { Authorization: aliceToken });
    assert(res.status === 200, 'Customer accessing own pottery request returns 200 OK');

    // 10. Customer can edit a requested request
    const updatedPotteryDate = new Date();
    updatedPotteryDate.setDate(updatedPotteryDate.getDate() + 25);
    const updatedPotteryDateStr = updatedPotteryDate.toISOString().split('T')[0];

    res = await request('PATCH', `/api/pottery/${alicePotteryId}`, { Authorization: aliceToken }, {
      itemId: 'i-03',
      glazeId: 'g-05',
      quantity: 8,
      neededBy: updatedPotteryDateStr,
    });
    assert(res.status === 200, 'Customer can edit requested pottery request (returns 200 OK)');
    assert(res.body.request.itemId === 'i-03' && res.body.request.quantity === 8, 'Request fields updated properly');

    // 16. Customer cannot accept/decline requests -> 403 Forbidden
    res = await request('PATCH', `/api/pottery/${alicePotteryId}/status`, { Authorization: aliceToken }, { status: 'accepted' });
    assert(res.status === 403, 'Customer cannot update pottery request status (returns 403 Forbidden)');

    // 14. Studio can accept a requested request -> 200
    res = await request('PATCH', `/api/pottery/${alicePotteryId}/status`, { Authorization: studioToken }, { status: 'accepted' });
    assert(res.status === 200, 'Studio can accept requested request (returns 200 OK)');
    assert(res.body.request.status === 'accepted', 'Request status transitioned to "accepted"');

    // 11. Customer cannot edit an accepted request -> 400
    res = await request('PATCH', `/api/pottery/${alicePotteryId}`, { Authorization: aliceToken }, { quantity: 10 });
    assert(res.status === 400, 'Customer cannot edit an accepted request (returns 400 Bad Request)');
    assert(res.body.error && res.body.error.includes('accepted'), 'Clear error stating request already accepted');

    // 13. Customer cannot cancel an accepted request -> 400
    res = await request('PATCH', `/api/pottery/${alicePotteryId}/cancel`, { Authorization: aliceToken });
    assert(res.status === 400, 'Customer cannot cancel an accepted request (returns 400 Bad Request)');

    // 12. Customer can cancel a requested request (using Bob's request)
    res = await request('PATCH', `/api/pottery/${bobPotteryId}/cancel`, { Authorization: bobToken });
    assert(res.status === 200, 'Customer can cancel a requested request (returns 200 OK)');
    assert(res.body.request.status === 'cancelled', 'Request status transitioned to "cancelled"');

    // 15. Studio can decline a requested request
    res = await request('POST', '/api/pottery', { Authorization: aliceToken }, { itemId: 'i-04', glazeId: 'g-06', quantity: 3, neededBy: validPotteryDateStr });
    const declineTestId = res.body.request._id;

    res = await request('PATCH', `/api/pottery/${declineTestId}/status`, { Authorization: studioToken }, { status: 'declined' });
    assert(res.status === 200, 'Studio can decline requested request (returns 200 OK)');
    assert(res.body.request.status === 'declined', 'Request status transitioned to "declined"');

    // Studio cannot re-modify an already declined request -> 400
    res = await request('PATCH', `/api/pottery/${declineTestId}/status`, { Authorization: studioToken }, { status: 'accepted' });
    assert(res.status === 400, 'Studio cannot re-modify an already declined request (returns 400)');

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
