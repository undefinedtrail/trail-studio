# Trail Studio

Trail Studio is a full-stack web application built for an art studio. It lets customers browse and buy unique folk paintings, book on-site wall murals, and request custom handmade pottery. It also gives the studio an admin dashboard to review and manage all requests.

Built with **Node.js**, **Express**, **MongoDB (Mongoose)**, and a simple vanilla HTML and JavaScript frontend.

GitHub Repository: [https://github.com/undefinedtrail/trail-studio](https://github.com/undefinedtrail/trail-studio)

---

## What the Studio Offers

### 1. Folk Paintings
- **Authentic Catalog**: 12 traditional Indian folk paintings loaded directly from the provided seed data (`seed.json`), complete with artwork photos, artist credits, and prices in rupees.
- **One of a Kind**: Each painting is unique and can only be bought once.
- **Safe Buying**: The server checks availability directly in MongoDB in a single step so two people clicking "Buy" at the exact same moment cannot both get it.
- **Order Cancellation**: If a customer cancels an order, the painting becomes available again in the shop.
- **Studio Controls**: Studio accounts can add new paintings or change details of an available painting.

### 2. Wall Murals
- **Booking Rules**: Customers can pick a date between 7 and 90 days away, choose a wall size between 10 and 500 square feet, and give an address.
- **Fair Pricing**: The price is automatically calculated as wall size multiplied by the studio rate (₹150 per sq ft from seed data).
- **No Double-Booking**: Each calendar date can only have one active booking. A database index stops anyone from taking an already booked date.
- **Studio Decisions**: The studio can confirm or decline a requested booking.
- **Easy Cancellation**: Customers can cancel their booking up to 3 days before the date, which frees up the date on the calendar for someone else.

### 3. Custom Pottery
- **Seed Options**: Customers can pick from 5 clay items (`Kulhad`, `Surahi`, `Matka`, `Diya set`, `Gamla`) and 6 natural glazes from the seed data.
- **Order Limits**: Quantity is between 1 and 12 pieces, and the date needed must be at least 14 days away to allow enough time to craft and kiln-fire the clay.
- **Studio Decisions**: The studio reviews and can accept or decline the request.
- **Editing & Cancelling**: Customers can edit or cancel their pottery request as long as it is still in `requested` status. Once accepted or declined by the studio, it is locked.

---

## User Roles and Security

The app has two roles:
1. **Customer**: Can register, browse and buy paintings, book mural dates, request custom pottery, and manage their own orders.
2. **Studio / Admin**: Can see all submissions, confirm or decline bookings, accept or decline pottery requests, and add or edit available paintings.

Every request to a protected route is checked by the server:
- If a user is not logged in, they receive `401 Unauthorized`.
- If someone tries an action for the wrong role (like a customer trying to approve a booking, or the studio trying to buy a painting), they receive `403 Forbidden`.
- If a customer tries to look at or edit another customer's booking or request, the server returns `404 Not Found` for privacy.

---

## How to Run on a Clean Machine

### Requirements
- **Node.js** (v18 or newer)
- **MongoDB** (running locally on port 27017 or a cloud MongoDB Atlas connection)

### 1. Clone and Install
```bash
git clone https://github.com/undefinedtrail/trail-studio.git
cd trail-studio
npm install
```

### 2. Set Up Environment Variables
Copy `.env.example` to create your `.env` file:
```bash
cp .env.example .env
```
Default settings in `.env.example`:
```env
PORT=3000
MONGO_URI=mongodb://127.0.0.1:27017/trail_studio
MONGO_URI_TEST=mongodb://127.0.0.1:27017/trail_studio_test
JWT_SECRET=trail-studio-super-secret-key-2025
RATE_PER_SQFT=150
```

### 3. Run Automated Tests
You can run the full test suite with one command:
```bash
npm test
```
*The tests run on a separate test database (`trail_studio_test`) so your normal data stays untouched.*

### 4. Start the Server
```bash
npm start
```
The server will connect to MongoDB, seed default accounts and the 12 folk paintings from `seed.json`, and run on `http://localhost:3000`.

Open **`http://localhost:3000`** in your web browser.

---

## Demo Accounts & Quick Testing

For quick testing, you can use the pre-seeded demo accounts or create a new account from the registration form:

| Role | Email | Password | What You Can Do |
| :--- | :--- | :--- | :--- |
| **Studio Admin** | `studio@artstudio.in` | `Studio@123` | View all customer orders, confirm/decline bookings, accept/decline pottery, add/edit paintings |
| **Customer (Alice)** | `alice@example.com` | `Customer@123` | Buy paintings, book wall dates, request pottery, cancel own orders |
| **Customer (Bob)** | `bob@example.com` | `Customer@123` | Second customer account to test privacy isolation and date conflicts |

*Tip: The login page has convenient **Quick Demo** buttons for Alice, Bob, and Studio Admin so you can fill in login details with a single click.*

### Testing Flow
1. Click **Alice (Customer)** and log in.
2. Go to **Paintings** and click **Buy Artwork** on any piece.
3. Go to **Wall Murals**, select a date 10 days away, enter `60` sq ft, and submit a booking.
4. Go to **Custom Pottery**, pick a `Kulhad` with `Kumkum Red` glaze, set quantity to `4`, pick a date 20 days away, and submit.
5. Log out and log in as **Studio Admin**:
   - Check the dashboard to confirm Alice's mural booking and accept her pottery request.
6. Log out and log in as **Bob**:
   - Verify that Bob cannot see Alice's orders or bookings.
   - Try to buy the painting Alice bought to verify the sold-out refusal message.
   - Try to book the date Alice booked to verify the date-taken refusal message.
