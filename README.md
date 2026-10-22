# Trail Studio

A clean, reliable, and complete full-stack web application for **Trail Studio**, an art studio specializing in traditional Indian folk paintings (Madhubani, Warli, Tanjore, Pattachitra, Kalamkari, Gond, Cheriyal) and handcrafted wall murals.

Built with **Node.js**, **Express**, and **MongoDB (Mongoose)**, featuring a handcrafted vanilla HTML/CSS/JavaScript frontend served directly by Express with zero external UI framework dependencies.

GitHub Repository: [https://github.com/undefinedtrail/trail-studio](https://github.com/undefinedtrail/trail-studio)

---

## 🎨 Overview & Features

### 1. Paintings Gallery & Sales
- **Official Seed Dataset**: Directly seeded from `seed.json` featuring 12 traditional paintings with authentic artist credits, high-resolution imagery, and pricing in INR (₹).
- **One-of-a-Kind Guarantee**: Each artwork is unique and can only be bought once.
- **Atomic Concurrency Protection**: High-concurrency purchases are handled via MongoDB atomic `findOneAndUpdate` queries, preventing race conditions.
- **Order Cancellation**: Customers can cancel an order, which instantly returns the painting to the catalog and restores its availability.

### 2. Wall Commission Bookings
- **Calendar Scheduling**: Customers can commission a wall mural by selecting a date **7 to 90 days** away, specifying the wall size (**10 to 500 sq ft**), and providing their physical address.
- **Double-Booking Prevention**: Each calendar date can only be booked once. Dates are normalized to UTC midnight, protected by a MongoDB **partial unique index** (`date: 1` where `status IN ['requested', 'confirmed']`).
- **Dynamic Pricing**: Automatically calculated as `wall_size × rate_per_sq_ft` (₹150/sq ft from seed data).
- **Studio Decision Flow**: Trail Studio admins can review, confirm, or decline bookings.
- **Customer Cancellation Policy**: Customers can cancel their booking up to **3 days** before the scheduled date; doing so releases the reserved date back onto the calendar.

### 3. Strict Role-Based Access Control (RBAC)
- **`401 Unauthorized`**: Returned if an authentication header is missing or references a non-existent user.
- **`403 Forbidden`**: Returned if a user attempts an action outside their role (e.g., customers attempting to add paintings or confirm bookings; studio accounts attempting to buy paintings or book walls).
- **`404 Not Found` (Customer Privacy)**: If a customer attempts to query, view, or modify another customer's record (`GET /api/bookings/:id`, order cancellation, or booking cancellation), the server strictly returns `404 Not Found` to prevent account enumeration.

### 4. Handmade, Minimalist Frontend
- Served directly by Express from `public/index.html`.
- Every data view explicitly handles and renders:
  1. **Loading State** (e.g., *"Loading artworks from Trail Studio collection..."*)
  2. **Empty State** (e.g., *"No paintings currently listed in the studio."*)
  3. **Error / Clear Refusal State** (e.g., *"This painting has already been sold."*, *"This date has already been booked. Please pick another date."*)
  4. **Success Feedback**
- Built-in **1-Click User Switcher** in the header to effortlessly test both Customer (`alice@example.com`, `bob@example.com`) and Trail Studio (`studio@artstudio.in`) views and permissions.

---

## 📋 RBAC Permissions Matrix

| Action | Customer | Studio / Admin | Behavior on Violation |
| :--- | :---: | :---: | :--- |
| **Browse Paintings** | ✅ Yes | ✅ Yes | `401 Unauthorized` if unauthenticated |
| **Add Artwork** | ❌ No | ✅ Yes | `403 Forbidden` for Customer |
| **Buy Artwork** | ✅ Yes | ❌ No | `403 Forbidden` for Studio |
| **Book Wall Mural Date** | ✅ Yes | ❌ No | `403 Forbidden` for Studio |
| **View Orders & Bookings** | ✅ Only Owned | ✅ All | `404 Not Found` if Customer views another customer's record |
| **Confirm / Decline Booking** | ❌ No | ✅ Yes | `403 Forbidden` for Customer |
| **Cancel Order or Booking** | ✅ Only Owned | ❌ No | `403 Forbidden` for Studio; `404 Not Found` if Customer tries to cancel another's record |

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js** (v18.x or newer)
- **MongoDB** (Local instance running at `mongodb://127.0.0.1:27017` or a cloud-hosted MongoDB Atlas URI)

### 1. Clone & Navigate
```bash
git clone https://github.com/undefinedtrail/trail-studio.git
cd trail-studio
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default `.env` configuration:
```env
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/trail_studio
RATE_PER_SQFT=150
```

### 4. Run the Automated Test Suite
To verify all RBAC rules, date calculations, concurrency locks, and ownership isolation:
```bash
npm test
```

### 5. Start the Application
```bash
npm start
```
The server will automatically connect to MongoDB, seed the 12 Indian folk paintings and default studio accounts from `seed.json`, and start on `http://localhost:3000`.

Open **`http://localhost:3000`** in your browser.

---

## 🧪 Testing the Application in the Browser

When opening `http://localhost:3000`:
1. **Quick Switcher Bar (Top Header)**:
   - Click **`Alice (Customer)`** to test customer capabilities (buying paintings, requesting wall bookings, viewing personal orders/bookings).
   - Click **`Bob (Customer)`** to test cross-customer isolation (Bob cannot see Alice's bookings or orders).
   - Click **`Trail Studio Admin`** to test studio management (adding paintings, approving/declining customer wall bookings, reviewing studio-wide orders).

2. **Testing Painting Concurrency**:
   - As Alice, buy an available painting. Notice that it immediately changes to "Sold Out".
   - Switch to Bob. Bob will see the painting is marked "Sold Out". If Bob attempts to buy it, the server refuses: `⚠️ Refusal: This painting has already been sold and is no longer available.`
   - Switch back to Alice and navigate to "My Bookings & Orders". Click "Cancel Order". The order is cancelled and the artwork returns to the catalog as available.

3. **Testing Wall Booking & Double-Booking Guard**:
   - As Alice, go to "Book a Wall Mural". Select a date 10 days from today, enter a size (e.g. 100 sq ft), and request the booking.
   - Switch to Bob. Try to book the **exact same date**. The application will clearly refuse the request: `⚠️ Booking Refused: This date has already been booked. Please pick another date.`
   - Switch to Trail Studio Admin. The Dashboard will display Alice's booking under "All Customer Wall Bookings" with buttons to **Confirm** or **Decline**.

4. **Testing 3-Day Cancellation Window**:
   - Bookings with 3 or more days remaining show an active "Cancel Booking" button.
   - Any booking within 3 days cannot be cancelled, protecting studio preparation time.

---

## 📁 Project Structure

```
.
├── server.js               # Main Express application, routing, and controllers
├── models/
│   └── db.js               # Mongoose schemas, indexes, and seed.json loader
├── middleware/
│   └── auth.js             # RBAC and customer ownership middleware
├── public/
│   ├── index.html          # Clean vanilla frontend (loading/empty/error states)
│   └── images/             # Artwork images (p-001.jpg - p-012.jpg)
├── seed.json               # Official studio dataset (paintings, mural rate, pottery, glazes)
├── test_api.js             # Comprehensive automated test runner
├── .env.example            # Environment variable template
├── .env                    # Local environment settings
├── package.json            # Node.js dependencies and scripts
├── DESIGN.md               # Architecture decisions, concurrency, and scope answers
└── README.md               # Project documentation
```

---

## 🔒 Design Decisions
For in-depth explanations regarding:
1. Header-based authentication and role enforcement
2. Database selection (MongoDB)
3. Concurrency guarantees (atomic `findOneAndUpdate` and partial unique indexing)
4. Scope breakdown (completed vs. out-of-scope)

Please refer to [`DESIGN.md`](file:///c:/Users/Venkat/Documents/GDGC%20Web/DESIGN.md).
