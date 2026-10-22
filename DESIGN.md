# System Design Document (DESIGN.md) · Trail Studio

### 1. How do login and the two roles work?
Authentication is handled through an HTTP header protocol (`x-user-email`, `x-user-id`, or `Authorization: Bearer <email>`). On every protected request, the server-side `authenticate` middleware in `middleware/auth.js` checks for the header, looks up the corresponding user document in MongoDB, and attaches `req.user` to the request object. If the header is missing or references a non-existent user, the server immediately returns `401 Unauthorized`.

The application implements two distinct roles enforced by `requireRole(...)`:
- **`customer`**: Can browse paintings, buy an available one-of-a-kind painting, book wall murals (7–90 days away, 10–500 sq ft), submit custom pottery requests (1–12 pieces, needed-by date >= 14 days), view their own records, edit or cancel pottery requests while still in `requested` state, cancel mural bookings up to 3 days before the date, and cancel orders (which restores the painting's availability). Customers cannot add or edit paintings, nor confirm or decline bookings or pottery requests (returning `403 Forbidden`).
- **`studio` / `admin`**: Initialized with `studio@artstudio.in` (from seed data). The studio can browse paintings, add new paintings, edit paintings while they are available, view all customer bookings, pottery requests, and orders, confirm/decline mural bookings, and accept/decline pottery requests. Studio accounts cannot purchase paintings, book murals, request pottery, or cancel customer records (returning `403 Forbidden`).

**Customer Privacy & Isolation**:
When a customer queries an individual record (`GET /api/bookings/:id`, `GET /api/pottery/:id`) or attempts to edit/cancel another customer's record, the server strictly returns **`404 Not Found`** (rather than 403). This prevents customer enumeration and ensures customers cannot verify whether another customer's record exists.

---

### 2. Which database did you choose, and why?
We chose **MongoDB with Mongoose**.
- **Document Model Ergonomics**: The data model maps directly to JSON structures for painting documents, bookings, orders, and pottery requests with Mongoose relationship references (`ref: 'User'`, `ref: 'Painting'`).
- **Atomic Operations for Concurrency**: MongoDB executes single-document updates atomically (`findOneAndUpdate`), allowing us to solve the one-of-a-kind painting concurrency problem in a single database step without external distributed locks.
- **Partial Unique Indexes**: MongoDB allows indexing a field with a `partialFilterExpression`. This enables us to enforce calendar date uniqueness strictly across active bookings (`requested` and `confirmed`) while permitting past cancelled or declined dates to remain in the collection for record-keeping.
- **Catalog vs Transaction Separation**: The 5 pottery items and 6 glazes are read directly from `seed.json` as the single source of truth for the catalog, while dynamic customer submissions are stored and indexed in MongoDB collections (`potteryrequests`, `bookings`, `orders`, `paintings`, `users`).

---

### 3. How do you stop two people from taking the same painting or date?

#### A. Paintings (One-of-a-Kind Concurrency Guarantee)
Each painting is unique and can only be bought once. To prevent two customers who click "Buy" at the same moment from both succeeding, the server executes an atomic conditional update:
```javascript
const updatedPainting = await Painting.findOneAndUpdate(
  { _id: paintingId, isAvailable: true },
  { $set: { isAvailable: false } },
  { new: true }
);
```
Because MongoDB guarantees document-level atomicity, only the first operation matches `{ isAvailable: true }` and modifies the document. The second simultaneous request matches zero documents and returns `null`. The server intercepts this and immediately returns an informative refusal message:
> *"This painting has already been sold and is no longer available."*

#### B. Wall Murals (Single Active Booking per Calendar Date)
1. **Date Normalization**: Incoming dates are normalized to UTC midnight (`YYYY-MM-DDT00:00:00.000Z`) so time zone offsets or local client clocks cannot create overlapping records for the same day.
2. **Partial Unique Index Constraint**:
   ```javascript
   bookingSchema.index(
     { date: 1 },
     {
       unique: true,
       partialFilterExpression: { status: { $in: ['requested', 'confirmed'] } }
     }
   );
   ```
3. **Double-Booking Rejection**: Even if two competing booking requests pass the application-level pre-check at the exact same millisecond, MongoDB's unique index constraint strictly rejects the second insert with error code `11000`. The server catches this error and returns a clear `409 Conflict` refusal response:
   > *"This date has already been booked. Please pick another date."*
4. **Automatic Calendar Release**: When a customer cancels their booking (allowed up to 3 days before the date) or the studio declines it, the status transitions away from `requested`/`confirmed`, automatically freeing the date for another customer.

---

### 4. What did you finish, what did you leave out, and what would you do next?

#### What was finished:
- **Seed Dataset Integration**: Directly loaded from `seed.json` with 12 traditional Indian folk paintings with images, artist credits, prices in INR, pottery items (`Kulhad`, `Surahi`, `Matka`, etc.), glazes, and mural rate of ₹150/sq ft.
- **Paintings Lifecycle**: Full browsing, studio addition, studio editing (while available), atomic concurrency-safe purchase, customer order tracking, and order cancellation that restores painting availability.
- **Wall Bookings Lifecycle**: Date validation (7–90 days out), wall size validation (10–500 sq ft), automated price calculation, double-booking prevention via partial unique index, studio confirmation/declination, and customer cancellation up to 3 days in advance.
- **Custom Pottery Lifecycle**: Customer submission with valid seed item and glaze validation, quantity (1–12), needed-by date (>= 14 days away), customer edit/cancel restricted strictly to `requested` status, and studio accept/decline.
- **Role-Based Access Control**: Server-side middleware enforcing `401 Unauthorized`, `403 Forbidden`, and `404 Not Found` for customer privacy isolation.
- **Handmade Frontend**: Minimalist HTML/JS interface with zero framework bloat, explicit Loading, Empty, Error/Refusal, and Success states across all views, plus a 1-click role switcher.
- **Automated Test Suite**: Integration test runner (`test_api.js`) verifying all 18 custom pottery test cases, concurrency safeguards, booking rules, and RBAC boundaries.

#### What was intentionally left out (per assignment Section 06 "Out of scope"):
The assignment explicitly stated not to spend time on the following areas:
- **Accounts**: Password reset, email verification, social login (OAuth/Google), and studio sign-up.
- **Payments**: Real payment processing (buying creates an order).
- **Extras**: Customer reviews, coupon codes, delivery tracking, and transactional emails/SMS.
- **Interface**: File upload pipelines, heavy animations, fancy CSS frameworks, and mobile-specific layouts.
- **Delivery**: Cloud deployment, Docker containers, and CI/CD pipelines.

#### What would be done next:
- **Real-Time Updates**: Add Server-Sent Events (SSE) or WebSockets so dates, painting availability, and pottery statuses update live without requiring a manual refresh.
- **Customer Email Notifications**: Connect a notification service (e.g. Nodemailer/SendGrid) to notify customers when their mural booking or pottery request is confirmed or accepted by the studio.
- **Pottery Photos & Specifications**: Add pottery dimensions and capacity specifications alongside the clay items.
