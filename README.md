# Trail Studio

A clean, reliable full-stack web application for **Trail Studio**, an artisan art studio providing original Indian folk art paintings, on-site wall mural commissions, and custom pottery.

Built for the recruitment assignment using **Node.js**, **Express**, **MongoDB (Mongoose)**, and a vanilla HTML/CSS/JavaScript frontend served directly by Express with zero external UI frameworks.

GitHub Repository: [https://github.com/undefinedtrail/trail-studio](https://github.com/undefinedtrail/trail-studio)

---

## 🎨 Overview & Core Services

### 1. Original Folk Paintings
- **Seed Catalog**: Sourced directly from `seed.json` featuring 12 traditional Indian folk art styles (Madhubani, Warli, Tanjore, Pattachitra, Kalamkari, Gond, Cheriyal, Pichwai, Nirmal, Kerala Mural) with authentic artist attributions and prices in INR (₹).
- **One-of-a-Kind Guarantee**: Each painting is unique and can only be bought once.
- **Concurrency Protection**: Purchases use an atomic MongoDB `findOneAndUpdate({ _id, isAvailable: true }, { $set: { isAvailable: false } })` query, preventing simultaneous double-purchases at the database level.
- **Studio Add & Edit**: Studio accounts can add new paintings and edit existing paintings only while they are available.
- **Order Cancellation**: When a customer cancels their order, the order status transitions to `cancelled` and the painting automatically becomes available again.

### 2. Wall Painting Commissions
- **Scheduling Rules**: Customers select a date between **7 and 90 days** from today, specify wall size between **10 and 500 sq ft**, and provide an address.
- **Dynamic Pricing**: Computed on the server as `wall_size × rate_per_sq_ft` (₹150/sq ft from seed data).
- **Double-Booking Prevention**: Each calendar date can have only one active booking (`requested` or `confirmed`). Dates are normalized to UTC midnight and guarded by a MongoDB **partial unique index** (`date: 1` filtered on active statuses).
- **Studio Decision**: Studio accounts can confirm or decline requested bookings.
- **Cancellation Policy**: Customers can cancel their booking up to **3 days** before the scheduled date; doing so releases the reserved date back onto the calendar.

### 3. Custom Pottery Requests
- **Seed-Driven Options**: Pottery items (`Kulhad`, `Surahi`, `Matka`, `Diya set`, `Gamla`) and glazes (`Kumkum Red`, `Haldi Yellow`, `Mehendi Green`, `Indigo Blue`, `Sandalwood Beige`, `Charcoal Black`) are validated directly against `seed.json`.
- **Validation**:
  - Quantity must be an integer from **1 to 12**.
  - Needed-by date must be at least **14 days** away from today to allow for pottery crafting, drying, glazing, and kiln firing.
- **Lifecycle & Status Transitions**:
  - `requested`: Initial state created by a customer.
  - `accepted` or `declined`: Updated by studio.
  - `cancelled`: Customer can cancel only while status is `requested`.
  - Customer can edit item, glaze, quantity, or needed-by date only while status is `requested`. Once accepted, declined, or cancelled, edits and customer cancellations are rejected by the server.

---

## 👥 Roles & RBAC Matrix

The server validates user identity and roles on every protected request:

| Capability | Customer | Studio / Admin | Violation Behavior |
| :--- | :---: | :---: | :--- |
| **Browse paintings** | ✅ Yes | ✅ Yes | `401 Unauthorized` if unauthenticated |
| **Add painting** | ❌ No | ✅ Yes | `403 Forbidden` for Customer |
| **Edit painting** (only while available) | ❌ No | ✅ Yes | `403 Forbidden` for Customer; `400` if already sold |
| **Buy painting** | ✅ Yes | ❌ No | `403 Forbidden` for Studio |
| **Book wall mural date** | ✅ Yes | ❌ No | `403 Forbidden` for Studio |
| **Request custom pottery** | ✅ Yes | ❌ No | `403 Forbidden` for Studio |
| **View orders, bookings, pottery** | ✅ Only Owned | ✅ All | `404 Not Found` if customer views another customer's record |
| **Confirm / decline bookings & pottery** | ❌ No | ✅ Yes | `403 Forbidden` for Customer |
| **Cancel order, booking, pottery** | ✅ Only Owned | ❌ No | `403 Forbidden` for Studio; `404` if customer accesses another's record |
| **Edit pottery request** (while requested) | ✅ Only Owned | ❌ No | `403 Forbidden` for Studio; `400` if already accepted/declined |

---

## 🚀 Quick Start Guide (Clean Machine)

### Prerequisites
- **Node.js** (v18.x or newer)
- **MongoDB** (Local instance on `mongodb://127.0.0.1:27017` or a MongoDB Atlas URI)

### 1. Clone & Install
```bash
git clone https://github.com/undefinedtrail/trail-studio.git
cd trail-studio
npm install
```

### 2. Environment Configuration
Create a `.env` file from `.env.example`:
```bash
cp .env.example .env
```
Default `.env` configuration:
```env
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/trail_studio
RATE_PER_SQFT=150
```

### 3. Run Automated Tests
Execute the comprehensive integration test suite covering RBAC, concurrency, date constraints, and all pottery transitions:
```bash
npm test
```

### 4. Start the Application
```bash
npm start
```
The server will connect to MongoDB, seed default users and the 12 Indian folk paintings from `seed.json`, and start listening on `http://localhost:3000`.

Open **`http://localhost:3000`** in your browser.

---

## 🧪 Browser Testing & Demo Walkthrough

1. **Role Switcher (Top Header)**:
   - Click **`Alice (Customer)`**:
     - Browse the paintings and click **Buy Artwork**.
     - Open **Book a Wall Mural**, pick a date 10 days out, enter 80 sq ft, and submit.
     - Open **Custom Pottery**, pick an item (`Kulhad`), glaze (`Kumkum Red`), quantity (4), and a date at least 14 days away, then submit.
     - Open **My Requests & Orders** to see all three submissions. Edit the pottery request while it is `requested` or cancel an order to release the painting.
   - Click **`Bob (Customer)`**:
     - Notice that Bob cannot see Alice's records (`404 Not Found` customer privacy isolation).
     - Try buying the painting Alice bought (`400` refusal: painting already sold).
     - Try booking the exact same date Alice booked (`409` refusal: date already taken).
   - Click **`Trail Studio Admin`**:
     - Opens the **Trail Studio Dashboard**.
     - Review customer wall bookings with **Confirm** and **Decline** options.
     - Review customer pottery requests with **Accept** and **Decline** options.
     - Add new paintings to the catalog or edit available paintings.

---

## 📁 Project Structure

```
.
├── server.js               # Express application, routes, controllers, and validation
├── models/
│   └── db.js               # Mongoose schemas (User, Painting, Order, Booking, PotteryRequest)
├── middleware/
│   └── auth.js             # RBAC and customer ownership middleware
├── public/
│   ├── index.html          # Clean vanilla frontend (loading, empty, error/refusal states)
│   └── images/             # Artwork images (p-001.jpg - p-012.jpg)
├── seed.json               # Seed dataset (paintings, pottery items, glazes, rate)
├── test_api.js             # Automated test suite (Paintings, Bookings, Pottery, RBAC)
├── .env.example            # Template for environment variables
├── package.json            # Node.js dependencies and test scripts
├── DESIGN.md               # Architecture explanations and scope documentation
└── README.md               # Project documentation
```
