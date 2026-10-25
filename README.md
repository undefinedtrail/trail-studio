# Trail Studio

Trail Studio is a full-stack artisan web application built for a traditional art and craft studio. It lets customers browse and purchase original Indian folk paintings, commission on-site architectural wall murals, and request custom handmade pottery. It also provides the studio administrator with a dedicated dashboard to manage catalog inventory, review incoming orders, and make decisions on mural bookings and pottery requests.

Built with **Node.js**, **Express**, **MongoDB (Mongoose)**, and a clean, modular HTML, CSS, and vanilla JavaScript frontend.

GitHub Repository: [https://github.com/undefinedtrail/trail-studio](https://github.com/undefinedtrail/trail-studio)

---

## What the Studio Offers

### 1. Artisan Folk Paintings
- **Authentic Collection**: Original Indian folk paintings loaded directly from the provided seed dataset (`seed.json`), featuring Madhubani, Warli, Tanjore, Pattachitra, Kalamkari, Gond, and Cheriyal styles with artist credits and rupee prices.
- **One of a Kind**: Each painting is an original piece and can only be bought once.
- **Safe Purchasing**: The server verifies painting availability atomically directly in MongoDB, so two customers clicking purchase at the exact same moment can never both acquire the same painting.
- **Order Cancellation**: If a customer cancels an order, the painting is automatically released back to available stock.
- **Studio Inventory Control**: Administrators can add new paintings and update details for available artworks.

### 2. Architectural Wall Murals
- **Booking Rules**: Customers select an execution date between 7 and 90 days in advance, specify wall size between 10 and 500 square feet, and provide the site address.
- **Transparent Pricing**: The price is calculated in real time as wall size multiplied by the studio rate (₹150 per sq ft from seed data).
- **Date Reservation & Conflict Prevention**: Each calendar date can have only one active booking. A database index prevents double-booking the same date even under simultaneous submissions.
- **Studio Decisions**: Administrators can review, confirm, or decline mural requests.
- **Customer Cancellation**: Customers can cancel their booking, which immediately releases the calendar date for other customers.

### 3. Custom Handmade Pottery
- **Seed Catalog**: Customers select from traditional earthenware shapes (`Kulhad`, `Surahi`, `Matka`, `Diya set`, `Gamla`) and natural mineral glazes from the seed data.
- **Order Quantities & Timeline**: Quantity is between 1 and 12 pieces, and the requested completion date must be at least 14 days in advance to allow proper wheel throwing, sun curing, and kiln firing.
- **Studio Decisions**: Administrators can accept or decline pottery commission requests.
- **Customer Modifications**: Customers can edit details or cancel requests while they remain in `requested` status. Once accepted or declined, the request is finalized.

---

## User Roles and Security

The application supports two distinct roles:
1. **Customer**: Can create an account, browse and buy paintings, commission murals, request custom pottery, and manage their own orders and bookings.
2. **Administrator / Studio**: Can view all orders and submissions, approve or decline mural bookings, accept or decline pottery commissions, and add or edit gallery inventory.

Security and access rules enforced on every server request:
- **Authentication**: Protected endpoints require a valid signed JSON Web Token (JWT) passed in the `Authorization: Bearer <token>` header. Unauthenticated requests receive `401 Unauthorized`.
- **Role Permissions**: Role-restricted actions (such as adding paintings or deciding on commissions) return `403 Forbidden` if attempted by an unauthorized role.
- **Customer Privacy**: If a customer attempts to inspect or modify another customer's booking or pottery request, the server returns `404 Not Found` for privacy protection.
- **Startup Protection**: The server checks for a configured `JWT_SECRET` on launch and exits with a clear error message if it is missing.

---

## How to Set Up and Run on a Clean Machine

### Requirements
- **Node.js** (v18 or newer)
- **MongoDB** (running locally on default port 27017 or accessible via connection string)

### 1. Clone and Install Dependencies
```bash
git clone https://github.com/undefinedtrail/trail-studio.git
cd trail-studio
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to create `.env`:
```bash
cp .env.example .env
```
Default configuration values:
```env
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/trail_studio
MONGO_URI_TEST=mongodb://127.0.0.1:27017/trail_studio_test
JWT_SECRET=trail-studio-super-secret-key-2025
RATE_PER_SQFT=150
```

### 3. Set Up Initial Accounts
Initialize the administrator and customer accounts using the dedicated setup command:
```bash
npm run setup-accounts
```
This script creates the initial accounts with secure bcrypt-hashed passwords. It is fully idempotent, preserving existing accounts and passwords without resetting them on future server restarts.

> **Security Notice**: Default accounts created for local evaluation are:
> - **Customer**: `user@gmail.com` (password: `user123`, role: `customer`)
> - **Administrator**: `admin@gmail.com` (password: `admin123`, role: `admin`)
>
> *These credentials are intended solely for local assignment testing and must be changed before any public or production deployment.*

### 4. Run Automated Test Suite
Run the comprehensive test suite with:
```bash
npm test
```
The test suite executes 55 automated checks covering authentication, password hashing, role permissions, concurrency, boundary validation, and customer privacy against an isolated test database (`trail_studio_test`).

### 5. Start the Application
Start the server:
```bash
npm start
```
The application will connect to MongoDB, seed the folk art collection from `seed.json` if needed, and serve the application on:
**`http://localhost:3000`**

---

## Testing User Flows

1. **Sign in as Customer**:
   - Log in using `user@gmail.com` (or create a new customer account using the registration form).
   - Browse the folk art gallery and purchase an available painting.
   - Fill out the wall mural form with your desired wall size and date to see real-time price calculation.
   - Submit a custom pottery request selecting vessel shape and mineral glaze.
   - Visit the **My Commissions** dashboard to view your collection and cancel an order or booking.

2. **Sign in as Administrator**:
   - Log in using `admin@gmail.com`.
   - Access the **Studio Dashboard** to view incoming customer orders across all three studio services.
   - Confirm or decline pending wall mural commissions and pottery requests.
   - Add a new painting to the catalog or edit pricing and details of available artworks.
