# System Design (DESIGN.md)

### 1. How do login and the two roles work?
Users log in with their email and password. Passwords are encrypted safely using bcrypt hashing, and the server returns a signed JSON Web Token (JWT) that the browser sends in the `Authorization: Bearer <token>` header for protected requests. The server requires a configured `JWT_SECRET` environment variable and fails startup with a clear error if it is missing.

The app has two roles: `customer` and `studio` (admin). Customers can register, browse and buy paintings, book wall dates, request custom pottery, and manage their own orders. The studio can view all customer submissions, confirm or decline bookings, accept or decline pottery requests, and add or edit available paintings. 

Our auth middleware checks user identity and roles on every protected route:
- If a user is not logged in, the server returns `401 Unauthorized`.
- If a user tries an action meant for the other role, the server returns `403 Forbidden`.
- If a customer tries to view or change another customer's record, the server returns `404 Not Found` for privacy so they cannot even tell the record exists.

---

### 2. Which database did you choose, and why?
We chose **MongoDB with Mongoose**.

MongoDB stores data in JSON-like documents, which fits our paintings, orders, bookings, and pottery requests cleanly without complex joins. It allows single-document atomic updates (`findOneAndUpdate`), which lets us check availability and mark a painting as sold in one single database operation. 

MongoDB also supports partial unique indexes. This lets us guarantee that a booking date is unique only while a booking is active (`requested` or `confirmed`), while still keeping cancelled or declined bookings in history.

**Replica Set vs Standalone Transactions:**
When connected to a MongoDB replica set (such as MongoDB Atlas or local replica sets), painting purchases and order cancellations run inside genuine multi-document ACID transactions (`startTransaction` / `commitTransaction`). If running on a standalone local MongoDB instance where replica sets are not configured, the system automatically detects this and falls back to atomic conditional operations with compensating rollback.

---

### 3. How do you stop two people from taking the same painting or date?

**For Paintings:**
We use MongoDB's atomic `findOneAndUpdate`:
```javascript
const updatedPainting = await Painting.findOneAndUpdate(
  { _id: paintingId, isAvailable: true },
  { $set: { isAvailable: false } },
  { new: true, ...sessionOpts }
);
```
Because this happens in a single atomic step in the database, only the first request succeeds. Any concurrent request finds `isAvailable` is already false and gets an immediate response explaining that the painting was already sold. On replica sets, this runs inside a multi-document transaction alongside order creation. On standalone MongoDB, a compensating rollback restores availability if order creation fails.

**For Wall Bookings:**
We normalize booking dates to UTC midnight and use a partial unique index on active bookings:
```javascript
bookingSchema.index(
  { date: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['requested', 'confirmed'] } } }
);
```
If two customers try to book the exact same date at the same time, the database stops the second insert with a duplicate key error (`11000`). The server catches this error and returns a friendly `409 Conflict` message saying the date is already taken. If a booking is later cancelled or declined, the date is automatically released and can be booked again.

---

### 4. What did you finish, what did you leave out, and what would you do next?

**What was finished:**
- Full login and registration with bcrypt password hashing and JWT tokens.
- All 3 services: original folk paintings from seed data, wall mural commissions with date and size validation, and custom pottery requests with item and glaze validation.
- All status flows: orders (`placed`, `cancelled`), bookings (`requested`, `confirmed`, `declined`, `cancelled`), and pottery requests (`requested`, `accepted`, `declined`, `cancelled`).
- Strict role permissions and customer privacy isolation (404 on other customers' data).
- Clean frontend with explicit loading, empty, and refusal messages, plus quick-fill demo login buttons.
- Automated API test suite covering all services, security checks, and concurrency against an isolated test database with strict safety protections.

**What was left out (out of scope):**
Following Section 06 of the assignment brief, we intentionally left out:
- Real payment gateway integration (buying creates an order record).
- Password reset, email verification, social login, and studio sign-up.
- Customer reviews, coupons, tracking, and transactional emails/SMS.
- File upload pipelines, heavy animations, and mobile-specific design frameworks.
- Cloud deployment, Docker containers, and CI/CD pipelines.

**What would be done next:**
- Real-time updates with WebSockets or Server-Sent Events so sold paintings and booked dates update instantly on everyone's screen.
- Email alerts to notify customers when their booking or pottery request is confirmed or accepted.
- Photo uploads for custom pottery sketches and reference dimensions.
