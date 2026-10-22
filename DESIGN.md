# System Design Document (DESIGN.md)

### 1. How do login and the two roles work?
Authentication is handled through a clean, header-based middleware protocol (`x-user-email`, `x-user-id`, or `Authorization: Bearer <token/email>`). On every protected request, the server-side `authenticate` middleware extracts the identity, verifies the user against the database, and attaches `req.user` to the request context. 

Two roles are enforced via `requireRole(...)`:
- **`customer`**: Can browse paintings, purchase available one-of-a-kind paintings, book wall dates (7–90 days out, 10–500 sq ft), view their own orders/bookings, cancel bookings (until 3 days prior), and cancel orders (which makes the painting available again). Customers cannot add paintings or confirm/decline bookings (returning `403 Forbidden`).
- **`admin`** (Studio): Can browse paintings, add new paintings, view all customer bookings and orders across the studio, and confirm or decline wall bookings. Admins cannot purchase paintings, book walls, or cancel customer records (returning `403 Forbidden`).

**Privacy & Ownership Enforcement**:
In accordance with the specification, if a customer attempts to view, query, or modify another customer's record (`GET /api/bookings/:id`, order cancellation, or booking cancellation), the server strictly responds with **`404 Not Found`** rather than `403 Forbidden`. This prevents customer enumeration and protects sensitive booking information.

---

### 2. Which database did you choose, and why?
We chose **MongoDB with Mongoose**.
- **Document Flexibility & Modeling**: Natural alignment with JavaScript/Node.js objects for nested references (`ref: 'User'`, `ref: 'Painting'`) and clear schema definitions with built-in type casting and validation.
- **Atomic Operations**: MongoDB provides atomic document-level operations (such as `findOneAndUpdate`), which are essential for solving the one-of-a-kind painting concurrency problem without requiring heavy external locking mechanisms.
- **Partial Unique Indexing**: MongoDB natively supports partial unique indexes, allowing us to enforce unique booking dates exclusively for active bookings (`status: { $in: ['requested', 'confirmed'] }`) while allowing previously cancelled or declined records to remain in history without blocking the calendar date.

---

### 3. How do you stop two people from taking the same painting or date?

#### A. Paintings (One-of-a-Kind Guarantee)
Each painting can only be bought once. To prevent race conditions where two customers click "Buy" at the exact same millisecond:
```javascript
const updatedPainting = await Painting.findOneAndUpdate(
  { _id: paintingId, isAvailable: true },
  { $set: { isAvailable: false } },
  { new: true }
);
```
Because MongoDB applies updates atomically to a document, only the first request can match `{ isAvailable: true }` and transition the status to `false`. Any simultaneous competing request finds no matching document and receives `null`, which the API catches and returns as a clear refusal message:
> *"This painting has already been sold and is no longer available."*

#### B. Wall Dates (Single Booking Guarantee)
Each calendar date can only be booked once for active reservations:
1. **Date Normalization**: All incoming dates are normalized to UTC midnight (`YYYY-MM-DDT00:00:00.000Z`) so time components or client timezone offsets cannot bypass the uniqueness rule.
2. **Database-Level Partial Unique Index**:
   ```javascript
   bookingSchema.index(
     { date: 1 },
     {
       unique: true,
       partialFilterExpression: { status: { $in: ['requested', 'confirmed'] } }
     }
   );
   ```
3. **Double-Booking Refusal**: In addition to an application-level pre-check, MongoDB's unique index constraint strictly rejects any duplicate insertion with error code `11000`. The server intercepts this and returns an informative `409 Conflict` refusal response:
   > *"This date has already been booked. Please pick another date."*
4. **Calendar Release on Cancellation**: If a customer cancels their booking (permitted until 3 days before the date) or the studio declines it, its status changes away from `requested`/`confirmed`, automatically releasing the date for other customers.

---

### 4. What did you finish, what did you leave out, and what would you do next?

#### What was finished:
- **Database Layer**: Models for Users, Paintings, Orders, and Bookings with validations, indexing, and seed utility.
- **Paintings Lifecycle**: Full browsing, admin addition, atomic customer purchase, and order cancellation that restores the painting's availability in the catalog.
- **Wall Bookings Lifecycle**: Date constraints (7–90 days away), size validation (10–500 sq ft), automated pricing calculation (`size × rate`), double-booking prevention, admin status updates (confirm/decline), and customer cancellation with the 3-day lead time rule.
- **RBAC & Security**: Complete middleware handling `401 Unauthorized`, `403 Forbidden`, and `404 Not Found` for customer privacy isolation.
- **Handmade Frontend**: Minimal, responsive HTML/JS UI with distinct Loading, Empty, Error/Refusal, and Success states for every view, complete with a 1-click role switcher for easy evaluation.
- **Automated Test Suite**: Comprehensive integration script (`test_api.js`) verifying all status codes, RBAC rules, date calculations, and concurrency safeguards.

#### What was left out:
- **Custom Pottery Requests**: Custom pottery requests (item/glaze selection, 14-day lead time) were omitted to focus on ensuring that the paintings catalog, concurrency guarantees, and wall booking workflows are completely robust, reliable, and bug-free (adhering to the brief's guideline: *"A small app that works beats a large one that breaks"*).
- **Out of Scope Features**: Real payment gateways, password reset/email verification, image file uploads, and CI/CD pipelines were intentionally omitted per Section 06 ("What you do not need to build") of the brief.

#### What would be done next:
- **Pottery Module**: Implement the pottery request endpoints, glaze selection schemas, and 14-day lead time validation.
- **Real-Time Calendar**: Add WebSockets (Socket.io) or Server-Sent Events (SSE) so dates and paintings reflect sold/booked states instantly across open browser sessions without requiring a manual refresh.
- **Automated Notifications**: Connect an email/SMS provider (e.g., SendGrid/Twilio) to notify customers when their wall booking is confirmed or declined by the studio.
