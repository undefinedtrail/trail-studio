# System Design & Architecture (DESIGN.md)

### 1. How do login and the two roles work?
Users sign in with their email and password. Passwords are never stored in plaintext; they are securely hashed using bcrypt (`salt rounds = 10`) before saving to the database. Upon successful login, the server issues a cryptographically signed JSON Web Token (JWT) that the browser sends in the `Authorization: Bearer <token>` header for subsequent requests. The server validates the `JWT_SECRET` environment variable at startup and terminates immediately with a clear error message if it is not configured.

The application enforces two distinct roles:
- **`customer`**: Can register, browse and buy available paintings, submit wall mural bookings, request custom pottery, and manage their own submissions.
- **`admin` / `studio`**: Can view all orders and requests across the platform, confirm or decline mural bookings, accept or decline pottery requests, and add or edit available paintings in the catalog.

Our centralized authentication and authorization middleware enforces strict checks on all protected endpoints:
- Missing or malformed authentication tokens return `401 Unauthorized`.
- Actions attempted by an unauthorized role (such as a customer attempting to confirm a mural, or an admin attempting to purchase a painting) return `403 Forbidden`.
- When a customer attempts to query or modify another customer's booking or pottery request, the server returns `404 Not Found` to preserve complete customer privacy and prevent resource enumeration.

---

### 2. Which database did you choose, and why?
We chose **MongoDB with Mongoose**.

MongoDB stores data as flexible, JSON-like documents, which naturally represents our paintings catalog, customer orders, mural bookings, and custom pottery requests without requiring complicated multi-table joins. Crucially, MongoDB supports atomic document operations (`findOneAndUpdate`), enabling us to check painting availability and mark it sold in a single database round-trip.

MongoDB also supports **partial unique indexes**, which allows us to enforce that a calendar date is unique only among active bookings (`requested` or `confirmed`), while allowing cancelled or declined bookings to remain preserved in history.

**Replica Set vs. Standalone Transactions:**
When deployed against a MongoDB replica set (such as MongoDB Atlas or local replica sets), painting purchases and order cancellations execute inside genuine multi-document ACID transactions (`startTransaction` / `commitTransaction`). When running on a standalone local MongoDB instance where replica sets are not enabled, our system automatically detects this environment and falls back to atomic conditional operations paired with compensating rollback logic.

---

### 3. How do you stop two people from taking the same painting or date?

**For Paintings:**
We use MongoDB's atomic `findOneAndUpdate` with a condition on `isAvailable: true`:
```javascript
const updatedPainting = await Painting.findOneAndUpdate(
  { _id: paintingId, isAvailable: true },
  { $set: { isAvailable: false } },
  { new: true, ...sessionOpts }
);
```
Because this condition and update occur atomically inside the database engine, only the first competing request can match and update the document. Any concurrent request arriving even milliseconds later finds `isAvailable` already `false`, receives `null`, and is immediately rejected with a clear message that the artwork was already sold. On replica sets, this operation is encapsulated in a multi-document ACID transaction alongside order creation.

**For Wall Bookings:**
We normalize all booking dates to UTC midnight to avoid timezone drift and enforce a partial unique index on active bookings:
```javascript
bookingSchema.index(
  { date: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['requested', 'confirmed'] } } }
);
```
If two customers submit requests for the same calendar date concurrently, MongoDB's unique index immediately rejects the second operation with a duplicate key error (`E11000`). Our server catches this error and returns a clean `409 Conflict` response explaining that the requested date is already reserved. If a customer cancels their booking, the status transitions to `cancelled`, which automatically releases the index and allows the date to be booked by another customer.

---

### 4. What was finished, what was left out, and what would you do next?

**What was finished:**
- Dedicated account setup script (`npm run setup-accounts`) initializing administrator and customer accounts with bcrypt password hashes.
- Secure email/password login and customer registration with JWT Bearer token authentication and show/hide password visibility toggles.
- Complete implementation of all 3 studio services from the seed dataset:
  1. 12 one-of-a-kind Indian folk paintings with concurrency-safe purchasing and order cancellation.
  2. Architectural wall mural bookings with live price calculation (₹150/sq ft), 7–90 day scheduling, and date conflict prevention.
  3. Custom pottery commission requests with seed vessel and glaze options, 1–12 piece quantities, and 14-day curing schedules.
- Complete lifecycle status flows for orders (`placed`, `cancelled`), bookings (`requested`, `confirmed`, `declined`, `cancelled`), and pottery (`requested`, `accepted`, `declined`, `cancelled`).
- Strict server-side RBAC and customer privacy isolation (404 on unowned records).
- Modular frontend architecture cleanly separated into `index.html`, `styles.css`, and `app.js` with an Indian artisan visual aesthetic.
- 55 automated API and security tests with test database safety checks.

**What was left out (out of scope):**
In alignment with the assignment specification, we intentionally did not include:
- Real payment gateway integration (purchasing creates an order record).
- Password recovery emails, phone verification, and third-party OAuth.
- Customer reviews, discount codes, shipping logistics, and SMS notifications.
- Heavy frontend frameworks or CSS utility bloat.
- Cloud container orchestration or CI/CD pipelines.

**What would be done next:**
- Real-time inventory and booking updates using WebSockets or Server-Sent Events (SSE) so purchased paintings and booked dates update instantly across active user sessions.
- Email notifications confirming order placement and status updates for commission decisions.
- Image uploads for architectural wall photos and customer pottery sketches.
