/**
 * Trail Studio — Frontend Application Logic
 * Vanilla JavaScript · Modular · Concurrency-Safe Client
 */

// ============================================================================
// 1. Application State
// ============================================================================
const AppState = {
  token: localStorage.getItem('trail_studio_token') || null,
  currentUser: null,
  config: {
    studioName: 'Trail Studio',
    ratePerSqFt: 150,
    currency: 'INR',
    potteryItems: [],
    glazes: [],
  },
  paintings: [],
  paintingFilter: 'all', // 'all' | 'available' | 'sold'
  
  // Customer Data
  customerOrders: [],
  customerBookings: [],
  customerPottery: [],

  // Admin Data
  adminOrders: [],
  adminBookings: [],
  adminPottery: [],
};

// Initialize stored user safely
try {
  const storedUser = localStorage.getItem('trail_studio_user');
  if (storedUser) {
    AppState.currentUser = JSON.parse(storedUser);
  }
} catch (e) {
  localStorage.removeItem('trail_studio_user');
}

// ============================================================================
// 2. Authentication & API Helpers
// ============================================================================
function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (AppState.token) {
    headers['Authorization'] = `Bearer ${AppState.token}`;
  }
  return headers;
}

function setSession(token, user) {
  AppState.token = token;
  AppState.currentUser = user;
  localStorage.setItem('trail_studio_token', token);
  localStorage.setItem('trail_studio_user', JSON.stringify(user));
  updateNavigationUI();
  showToast(`Welcome, ${user.email}!`, 'success');
  loadInitialData();
}

function clearSession(notify = true) {
  AppState.token = null;
  AppState.currentUser = null;
  localStorage.removeItem('trail_studio_token');
  localStorage.removeItem('trail_studio_user');
  updateNavigationUI();
  renderPaintings();
  if (notify) {
    showToast('Logged out successfully.', 'info');
  }
  showView('authSection');
}

async function verifyAuthSession() {
  if (!AppState.token) {
    updateNavigationUI();
    return;
  }

  try {
    const res = await fetch('/api/auth/me', { headers: getAuthHeaders() });
    if (res.ok) {
      const data = await res.json();
      AppState.currentUser = data.user;
      localStorage.setItem('trail_studio_user', JSON.stringify(data.user));
    } else {
      clearSession(false);
    }
  } catch (err) {
    console.warn('Session verification error:', err.message);
  } finally {
    updateNavigationUI();
  }
}

// ============================================================================
// 3. UI Helpers: Toasts, Modals & Formatters
// ============================================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button class="toast-close" type="button" aria-label="Dismiss">&times;</button>
  `;

  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.remove();
  });

  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }
  }, 4000);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPrice(amount) {
  return '₹' + Number(amount || 0).toLocaleString('en-IN');
}

function formatDate(dateInput) {
  if (!dateInput) return '-';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.innerHTML = '🙈';
    btn.setAttribute('aria-label', 'Hide password');
  } else {
    input.type = 'password';
    btn.innerHTML = '👁️';
    btn.setAttribute('aria-label', 'Show password');
  }
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

// Global modal background click and Escape key listeners
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach((m) => m.classList.remove('active'));
  }
});

// ============================================================================
// 4. Navigation & View Controller
// ============================================================================
function updateNavigationUI() {
  const navAuthGuest = document.getElementById('navAuthGuest');
  const navAuthUser = document.getElementById('navAuthUser');
  const userEmailLabel = document.getElementById('userEmailLabel');
  const userRoleBadge = document.getElementById('userRoleBadge');
  const customerDashboardLink = document.getElementById('customerDashboardLink');
  const adminDashboardLink = document.getElementById('adminDashboardLink');
  const authSection = document.getElementById('authSection');
  const customerDashboardSection = document.getElementById('customerDashboardSection');
  const adminDashboardSection = document.getElementById('adminDashboardSection');
  const adminAddPaintingBtn = document.getElementById('adminAddPaintingBtn');

  if (AppState.currentUser) {
    if (navAuthGuest) navAuthGuest.style.display = 'none';
    if (navAuthUser) navAuthUser.style.display = 'flex';
    if (userEmailLabel) userEmailLabel.textContent = AppState.currentUser.email;

    const isAdmin = AppState.currentUser.role === 'admin' || AppState.currentUser.role === 'studio';

    if (userRoleBadge) {
      userRoleBadge.textContent = isAdmin ? 'Administrator' : 'Customer';
      userRoleBadge.className = `role-badge ${isAdmin ? 'role-admin' : 'role-customer'}`;
    }

    if (authSection) authSection.style.display = 'none';
    if (adminAddPaintingBtn) adminAddPaintingBtn.style.display = isAdmin ? 'inline-block' : 'none';

    if (isAdmin) {
      if (adminDashboardLink) adminDashboardLink.style.display = 'inline-block';
      if (customerDashboardLink) customerDashboardLink.style.display = 'none';
      if (adminDashboardSection) adminDashboardSection.style.display = 'block';
      if (customerDashboardSection) customerDashboardSection.style.display = 'none';
    } else {
      if (adminDashboardLink) adminDashboardLink.style.display = 'none';
      if (customerDashboardLink) customerDashboardLink.style.display = 'inline-block';
      if (adminDashboardSection) adminDashboardSection.style.display = 'none';
      if (customerDashboardSection) customerDashboardSection.style.display = 'block';
    }
  } else {
    if (navAuthGuest) navAuthGuest.style.display = 'flex';
    if (navAuthUser) navAuthUser.style.display = 'none';
    if (customerDashboardLink) customerDashboardLink.style.display = 'none';
    if (adminDashboardLink) adminDashboardLink.style.display = 'none';
    if (authSection) authSection.style.display = 'block';
    if (customerDashboardSection) customerDashboardSection.style.display = 'none';
    if (adminDashboardSection) adminDashboardSection.style.display = 'none';
    if (adminAddPaintingBtn) adminAddPaintingBtn.style.display = 'none';
  }
}

function showView(elementId) {
  const el = document.getElementById(elementId);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth' });
  }
}

// ============================================================================
// 5. Config & Initial Data Loading
// ============================================================================
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      AppState.config = await res.json();
      setupMuralFormConstraints();
      setupPotteryFormOptions();
    }
  } catch (err) {
    console.error('Failed to load studio config:', err.message);
  }
}

async function loadInitialData() {
  await loadConfig();
  if (AppState.token) {
    await loadPaintings();
    if (AppState.currentUser) {
      const isAdmin = AppState.currentUser.role === 'admin' || AppState.currentUser.role === 'studio';
      if (isAdmin) {
        await loadAdminDashboardData();
      } else {
        await loadCustomerDashboardData();
      }
    }
  } else {
    // Guest view: render placeholder / prompt
    renderPaintings();
  }
}

// ============================================================================
// 6. Paintings Gallery (Browse, Buy, Add, Edit)
// ============================================================================
async function loadPaintings() {
  if (!AppState.token) return;

  try {
    const res = await fetch('/api/paintings', { headers: getAuthHeaders() });
    if (res.ok) {
      AppState.paintings = await res.json();
      renderPaintings();
    } else if (res.status === 401) {
      clearSession(false);
    }
  } catch (err) {
    console.error('Failed to load paintings:', err.message);
  }
}

function filterPaintings(filter) {
  AppState.paintingFilter = filter;
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderPaintings();
}

function renderPaintings() {
  const grid = document.getElementById('paintingsGrid');
  if (!grid) return;

  if (!AppState.token) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-state-icon">🎨</div>
        <h4>Artisan Folk Art Collection</h4>
        <p>Please sign in with your account to browse our full catalog of original Indian folk paintings and place purchase orders.</p>
        <button class="btn btn-primary" style="margin-top: 14px;" onclick="showView('authSection')">Sign In to View Collection</button>
      </div>
    `;
    return;
  }

  let filtered = AppState.paintings;
  if (AppState.paintingFilter === 'available') {
    filtered = AppState.paintings.filter((p) => p.isAvailable);
  } else if (AppState.paintingFilter === 'sold') {
    filtered = AppState.paintings.filter((p) => !p.isAvailable);
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-state-icon">🖼️</div>
        <h4>No Paintings Found</h4>
        <p>There are no paintings matching the selected status filter.</p>
      </div>
    `;
    return;
  }

  const isAdmin = AppState.currentUser && (AppState.currentUser.role === 'admin' || AppState.currentUser.role === 'studio');

  grid.innerHTML = filtered
    .map((painting) => {
      const isAvailable = painting.isAvailable;
      const badgeClass = isAvailable ? 'badge-available' : 'badge-sold';
      const badgeText = isAvailable ? 'Available' : 'Sold &amp; Archived';

      let actionHtml = '';
      if (isAdmin) {
        if (isAvailable) {
          actionHtml = `<button class="btn btn-secondary btn-sm" onclick="openEditPaintingModal('${painting._id}')">Edit Details</button>`;
        } else {
          actionHtml = `<span class="status-pill status-declined">Sold (Locked)</span>`;
        }
      } else {
        if (isAvailable) {
          actionHtml = `<button class="btn btn-primary btn-sm" onclick="buyPainting('${painting._id}', '${escapeHtml(painting.title)}')">Purchase Painting</button>`;
        } else {
          actionHtml = `<button class="btn btn-secondary btn-sm" disabled>Sold Out</button>`;
        }
      }

      const imgPath = painting.imageUrl ? painting.imageUrl : 'images/p-001.jpg';

      return `
        <article class="painting-card" id="painting-${painting._id}">
          <div class="painting-img-wrapper">
            <img src="${escapeHtml(imgPath)}" alt="${escapeHtml(painting.title)}" class="painting-img" loading="lazy" onerror="this.src='images/p-001.jpg'">
            <span class="painting-badge ${badgeClass}">${badgeText}</span>
          </div>
          <div class="painting-content">
            <div class="painting-code">${escapeHtml(painting.code || 'ARTISAN PIECE')}</div>
            <h3 class="painting-title">${escapeHtml(painting.title)}</h3>
            <div class="painting-artist">By ${escapeHtml(painting.artist || 'Trail Studio Artist')}</div>
            <p class="painting-desc">${escapeHtml(painting.description || 'Authentic handcrafted Indian traditional artwork.')}</p>
            <div class="painting-footer">
              <div class="painting-price">${formatPrice(painting.price)}</div>
              <div class="painting-actions">${actionHtml}</div>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

// Purchase Painting (Customer Action with Concurrency Safety)
async function buyPainting(paintingId, paintingTitle) {
  if (!confirm(`Confirm purchase of "${paintingTitle}"?\n\nEach painting is a unique original and can only be bought once.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/paintings/${paintingId}/buy`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });

    const data = await res.json();

    if (res.ok) {
      showToast(`Congratulations! You purchased "${paintingTitle}".`, 'success');
      await loadPaintings();
      await loadCustomerDashboardData();
    } else {
      showToast(data.error || 'Could not complete purchase.', 'error');
      await loadPaintings();
    }
  } catch (err) {
    showToast('Network error during purchase: ' + err.message, 'error');
  }
}

// Add New Painting (Administrator Action)
function openAddPaintingModal() {
  document.getElementById('addPaintingForm').reset();
  openModal('addPaintingModal');
}

async function handleAddPaintingSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const title = form.title.value.trim();
  const artist = form.artist.value.trim();
  const price = Number(form.price.value);
  const imageUrl = form.imageUrl.value.trim();
  const description = form.description.value.trim();

  if (!title || !price || price <= 0) {
    showToast('Please provide a valid title and positive price.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/paintings', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ title, artist, price, imageUrl, description }),
    });

    const data = await res.json();

    if (res.ok) {
      showToast(`Painting "${title}" added successfully.`, 'success');
      closeModal('addPaintingModal');
      form.reset();
      await loadPaintings();
      await loadAdminDashboardData();
    } else {
      showToast(data.error || 'Failed to add painting.', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// Edit Painting (Administrator Action)
let currentEditPaintingId = null;

function openEditPaintingModal(paintingId) {
  const painting = AppState.paintings.find((p) => p._id === paintingId);
  if (!painting) return;

  currentEditPaintingId = paintingId;
  const form = document.getElementById('editPaintingForm');
  form.editTitle.value = painting.title;
  form.editArtist.value = painting.artist || '';
  form.editPrice.value = painting.price;
  form.editImageUrl.value = painting.imageUrl || '';
  form.editDescription.value = painting.description || '';

  openModal('editPaintingModal');
}

async function handleEditPaintingSubmit(e) {
  e.preventDefault();
  if (!currentEditPaintingId) return;

  const form = e.target;
  const title = form.editTitle.value.trim();
  const artist = form.editArtist.value.trim();
  const price = Number(form.editPrice.value);
  const imageUrl = form.editImageUrl.value.trim();
  const description = form.editDescription.value.trim();

  try {
    const res = await fetch(`/api/paintings/${currentEditPaintingId}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ title, artist, price, imageUrl, description }),
    });

    const data = await res.json();

    if (res.ok) {
      showToast('Painting details updated successfully.', 'success');
      closeModal('editPaintingModal');
      await loadPaintings();
      await loadAdminDashboardData();
    } else {
      showToast(data.error || 'Failed to update painting.', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// ============================================================================
// 7. Wall Mural Bookings Flow
// ============================================================================
function setupMuralFormConstraints() {
  const dateInput = document.getElementById('muralDate');
  const sizeInput = document.getElementById('muralSize');
  const calcRateLabel = document.getElementById('calcRateLabel');

  if (calcRateLabel) {
    calcRateLabel.textContent = `₹${AppState.config.ratePerSqFt || 150} / sq ft`;
  }

  if (dateInput) {
    const minD = new Date();
    minD.setDate(minD.getDate() + 7);
    const maxD = new Date();
    maxD.setDate(maxD.getDate() + 90);

    dateInput.min = minD.toISOString().split('T')[0];
    dateInput.max = maxD.toISOString().split('T')[0];
  }

  if (sizeInput) {
    sizeInput.addEventListener('input', calculateMuralEstimate);
  }
}

function calculateMuralEstimate() {
  const sizeInput = document.getElementById('muralSize');
  const priceDisplay = document.getElementById('muralCalculatedPrice');
  const formulaDisplay = document.getElementById('muralFormulaDisplay');

  if (!sizeInput || !priceDisplay) return;

  const size = Number(sizeInput.value);
  const rate = AppState.config.ratePerSqFt || 150;

  if (size >= 10 && size <= 500) {
    const total = size * rate;
    priceDisplay.textContent = formatPrice(total);
    if (formulaDisplay) {
      formulaDisplay.textContent = `${size} sq ft × ₹${rate} = ${formatPrice(total)}`;
    }
  } else {
    priceDisplay.textContent = '₹0';
    if (formulaDisplay) {
      formulaDisplay.textContent = 'Please enter a size between 10 and 500 sq ft';
    }
  }
}

async function handleMuralBookingSubmit(e) {
  e.preventDefault();

  if (!AppState.token) {
    showToast('Please sign in as a customer to book a mural.', 'error');
    showView('authSection');
    return;
  }

  if (AppState.currentUser && (AppState.currentUser.role === 'admin' || AppState.currentUser.role === 'studio')) {
    showToast('Administrators cannot create customer bookings.', 'error');
    return;
  }

  const form = e.target;
  const date = form.muralDate.value;
  const size = Number(form.muralSize.value);
  const address = form.muralAddress.value.trim();

  if (!date || !size || !address) {
    showToast('Please fill out all booking fields.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ date, size, address }),
    });

    const data = await res.json();

    if (res.ok) {
      showToast('Wall mural commission request submitted successfully!', 'success');
      form.reset();
      calculateMuralEstimate();
      await loadCustomerDashboardData();
      showView('customerDashboardSection');
    } else {
      showToast(data.error || 'Failed to submit mural booking.', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// ============================================================================
// 8. Custom Pottery Commission Flow
// ============================================================================
function setupPotteryFormOptions() {
  const itemSelect = document.getElementById('potteryItemSelect');
  const glazeSelect = document.getElementById('potteryGlazeSelect');
  const dateInput = document.getElementById('potteryNeededBy');

  if (itemSelect && Array.isArray(AppState.config.potteryItems)) {
    itemSelect.innerHTML = `
      <option value="">Select Handcrafted Shape...</option>
      ${AppState.config.potteryItems.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}
    `;
  }

  if (glazeSelect && Array.isArray(AppState.config.glazes)) {
    glazeSelect.innerHTML = `
      <option value="">Select Natural Mineral Glaze...</option>
      ${AppState.config.glazes.map((glaze) => `<option value="${escapeHtml(glaze.id)}">${escapeHtml(glaze.name)}</option>`).join('')}
    `;
  }

  if (dateInput) {
    const minD = new Date();
    minD.setDate(minD.getDate() + 14);
    dateInput.min = minD.toISOString().split('T')[0];
  }
}

async function handlePotteryRequestSubmit(e) {
  e.preventDefault();

  if (!AppState.token) {
    showToast('Please sign in as a customer to commission pottery.', 'error');
    showView('authSection');
    return;
  }

  if (AppState.currentUser && (AppState.currentUser.role === 'admin' || AppState.currentUser.role === 'studio')) {
    showToast('Administrators cannot create customer pottery requests.', 'error');
    return;
  }

  const form = e.target;
  const itemId = form.potteryItemSelect.value;
  const glazeId = form.potteryGlazeSelect.value;
  const quantity = Number(form.potteryQuantity.value);
  const neededBy = form.potteryNeededBy.value;

  if (!itemId || !glazeId || !quantity || !neededBy) {
    showToast('Please fill out all pottery commission details.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/pottery', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ itemId, glazeId, quantity, neededBy }),
    });

    const data = await res.json();

    if (res.ok) {
      showToast('Custom pottery commission request created successfully!', 'success');
      form.reset();
      await loadCustomerDashboardData();
      showView('customerDashboardSection');
    } else {
      showToast(data.error || 'Failed to submit pottery request.', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// ============================================================================
// 9. Customer Dashboard Operations
// ============================================================================
async function loadCustomerDashboardData() {
  if (!AppState.token || (AppState.currentUser && AppState.currentUser.role !== 'customer')) {
    return;
  }

  try {
    const [ordersRes, bookingsRes, potteryRes] = await Promise.all([
      fetch('/api/orders', { headers: getAuthHeaders() }),
      fetch('/api/bookings', { headers: getAuthHeaders() }),
      fetch('/api/pottery', { headers: getAuthHeaders() }),
    ]);

    if (ordersRes.ok) AppState.customerOrders = await ordersRes.json();
    if (bookingsRes.ok) AppState.customerBookings = await bookingsRes.json();
    if (potteryRes.ok) AppState.customerPottery = await potteryRes.json();

    renderCustomerDashboard();
  } catch (err) {
    console.error('Failed to load customer dashboard data:', err.message);
  }
}

function renderCustomerDashboard() {
  renderCustomerOrdersTable();
  renderCustomerBookingsTable();
  renderCustomerPotteryTable();
}

function renderCustomerOrdersTable() {
  const container = document.getElementById('custOrdersTableBody');
  if (!container) return;

  if (!AppState.customerOrders || AppState.customerOrders.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">You have not purchased any paintings yet.</td>
      </tr>
    `;
    return;
  }

  container.innerHTML = AppState.customerOrders
    .map((order) => {
      const painting = order.paintingId || {};
      const isPlaced = order.status === 'placed';
      const statusPill = isPlaced
        ? '<span class="status-pill status-placed">Placed</span>'
        : '<span class="status-pill status-cancelled">Cancelled</span>';

      const actionBtn = isPlaced
        ? `<button class="btn btn-danger btn-sm" onclick="cancelOrder('${order._id}')">Cancel Order</button>`
        : '<span style="color: var(--color-text-muted); font-size: 0.8rem;">No Actions</span>';

      return `
        <tr>
          <td><strong>${escapeHtml(painting.title || 'Painting')}</strong><div style="font-size: 0.75rem; color: var(--color-text-muted);">${escapeHtml(painting.code || '')}</div></td>
          <td>${escapeHtml(painting.artist || 'Trail Studio Artist')}</td>
          <td>${formatPrice(painting.price)}</td>
          <td>${formatDate(order.createdAt)}</td>
          <td>${statusPill}</td>
          <td>${actionBtn}</td>
        </tr>
      `;
    })
    .join('');
}

function renderCustomerBookingsTable() {
  const container = document.getElementById('custBookingsTableBody');
  if (!container) return;

  if (!AppState.customerBookings || AppState.customerBookings.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">No wall mural commissions booked yet.</td>
      </tr>
    `;
    return;
  }

  container.innerHTML = AppState.customerBookings
    .map((booking) => {
      const status = booking.status;
      let statusPill = `<span class="status-pill status-${status}">${status}</span>`;

      const canCancel = status === 'requested' || status === 'confirmed';
      const actionBtn = canCancel
        ? `<button class="btn btn-danger btn-sm" onclick="cancelBooking('${booking._id}')">Cancel Booking</button>`
        : '<span style="color: var(--color-text-muted); font-size: 0.8rem;">Locked</span>';

      return `
        <tr>
          <td><strong>${formatDate(booking.date)}</strong></td>
          <td>${booking.size} sq ft</td>
          <td>${formatPrice(booking.price)}</td>
          <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(booking.address)}">${escapeHtml(booking.address)}</td>
          <td>${statusPill}</td>
          <td>${actionBtn}</td>
        </tr>
      `;
    })
    .join('');
}

function renderCustomerPotteryTable() {
  const container = document.getElementById('custPotteryTableBody');
  if (!container) return;

  if (!AppState.customerPottery || AppState.customerPottery.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">No custom pottery requests placed yet.</td>
      </tr>
    `;
    return;
  }

  container.innerHTML = AppState.customerPottery
    .map((req) => {
      const itemObj = (AppState.config.potteryItems || []).find((i) => i.id === req.itemId) || { name: req.itemId };
      const glazeObj = (AppState.config.glazes || []).find((g) => g.id === req.glazeId) || { name: req.glazeId };
      const status = req.status;
      const statusPill = `<span class="status-pill status-${status}">${status}</span>`;

      let actions = '<span style="color: var(--color-text-muted); font-size: 0.8rem;">Locked</span>';
      if (status === 'requested') {
        actions = `
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-secondary btn-sm" onclick="openEditPotteryModal('${req._id}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="cancelPotteryRequest('${req._id}')">Cancel</button>
          </div>
        `;
      }

      return `
        <tr>
          <td><strong>${escapeHtml(itemObj.name)}</strong></td>
          <td>${escapeHtml(glazeObj.name)}</td>
          <td>${req.quantity} pcs</td>
          <td>${formatDate(req.neededBy)}</td>
          <td>${statusPill}</td>
          <td>${actions}</td>
        </tr>
      `;
    })
    .join('');
}

// Cancel Customer Order
async function cancelOrder(orderId) {
  if (!confirm('Are you sure you want to cancel this painting purchase? The artwork will become available for others to buy.')) {
    return;
  }

  try {
    const res = await fetch(`/api/orders/${orderId}/cancel`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
    });

    const data = await res.json();

    if (res.ok) {
      showToast('Order cancelled successfully. Painting returned to available stock.', 'success');
      await loadPaintings();
      await loadCustomerDashboardData();
    } else {
      showToast(data.error || 'Failed to cancel order.', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// Cancel Customer Booking
async function cancelBooking(bookingId) {
  if (!confirm('Cancel this mural booking? The calendar date will be released.')) {
    return;
  }

  try {
    const res = await fetch(`/api/bookings/${bookingId}/cancel`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
    });

    const data = await res.json();

    if (res.ok) {
      showToast('Mural booking cancelled.', 'info');
      await loadCustomerDashboardData();
    } else {
      showToast(data.error || 'Failed to cancel booking.', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// Cancel Customer Pottery Request
async function cancelPotteryRequest(potteryId) {
  if (!confirm('Cancel this custom pottery commission request?')) {
    return;
  }

  try {
    const res = await fetch(`/api/pottery/${potteryId}/cancel`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
    });

    const data = await res.json();

    if (res.ok) {
      showToast('Pottery commission request cancelled.', 'info');
      await loadCustomerDashboardData();
    } else {
      showToast(data.error || 'Failed to cancel pottery request.', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// Edit Customer Pottery Request
let currentEditPotteryId = null;

function openEditPotteryModal(potteryId) {
  const req = AppState.customerPottery.find((p) => p._id === potteryId);
  if (!req) return;

  currentEditPotteryId = potteryId;
  const form = document.getElementById('editPotteryForm');
  
  // Populate edit selects
  form.editPotteryItem.innerHTML = (AppState.config.potteryItems || []).map((i) => `
    <option value="${escapeHtml(i.id)}" ${i.id === req.itemId ? 'selected' : ''}>${escapeHtml(i.name)}</option>
  `).join('');

  form.editPotteryGlaze.innerHTML = (AppState.config.glazes || []).map((g) => `
    <option value="${escapeHtml(g.id)}" ${g.id === req.glazeId ? 'selected' : ''}>${escapeHtml(g.name)}</option>
  `).join('');

  form.editPotteryQuantity.value = req.quantity;

  const minD = new Date();
  minD.setDate(minD.getDate() + 14);
  form.editPotteryNeededBy.min = minD.toISOString().split('T')[0];

  const dateStr = new Date(req.neededBy).toISOString().split('T')[0];
  form.editPotteryNeededBy.value = dateStr;

  openModal('editPotteryModal');
}

async function handleEditPotterySubmit(e) {
  e.preventDefault();
  if (!currentEditPotteryId) return;

  const form = e.target;
  const itemId = form.editPotteryItem.value;
  const glazeId = form.editPotteryGlaze.value;
  const quantity = Number(form.editPotteryQuantity.value);
  const neededBy = form.editPotteryNeededBy.value;

  try {
    const res = await fetch(`/api/pottery/${currentEditPotteryId}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ itemId, glazeId, quantity, neededBy }),
    });

    const data = await res.json();

    if (res.ok) {
      showToast('Pottery commission request updated.', 'success');
      closeModal('editPotteryModal');
      await loadCustomerDashboardData();
    } else {
      showToast(data.error || 'Failed to update pottery request.', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// ============================================================================
// 10. Administrator Dashboard Operations
// ============================================================================
async function loadAdminDashboardData() {
  if (!AppState.token || !AppState.currentUser || (AppState.currentUser.role !== 'admin' && AppState.currentUser.role !== 'studio')) {
    return;
  }

  try {
    const [ordersRes, bookingsRes, potteryRes] = await Promise.all([
      fetch('/api/orders', { headers: getAuthHeaders() }),
      fetch('/api/bookings', { headers: getAuthHeaders() }),
      fetch('/api/pottery', { headers: getAuthHeaders() }),
    ]);

    if (ordersRes.ok) AppState.adminOrders = await ordersRes.json();
    if (bookingsRes.ok) AppState.adminBookings = await bookingsRes.json();
    if (potteryRes.ok) AppState.adminPottery = await potteryRes.json();

    renderAdminDashboard();
  } catch (err) {
    console.error('Failed to load administrator data:', err.message);
  }
}

function renderAdminDashboard() {
  renderAdminOrdersTable();
  renderAdminBookingsTable();
  renderAdminPotteryTable();
}

function renderAdminOrdersTable() {
  const container = document.getElementById('adminOrdersTableBody');
  if (!container) return;

  if (!AppState.adminOrders || AppState.adminOrders.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">No customer painting orders recorded.</td>
      </tr>
    `;
    return;
  }

  container.innerHTML = AppState.adminOrders
    .map((order) => {
      const painting = order.paintingId || {};
      const customer = order.customerId || {};
      const statusPill = order.status === 'placed'
        ? '<span class="status-pill status-placed">Placed</span>'
        : '<span class="status-pill status-cancelled">Cancelled</span>';

      return `
        <tr>
          <td><strong>${escapeHtml(painting.title || 'Untitled')}</strong></td>
          <td>${escapeHtml(customer.email || 'Customer')}</td>
          <td>${formatPrice(painting.price)}</td>
          <td>${formatDate(order.createdAt)}</td>
          <td>${statusPill}</td>
        </tr>
      `;
    })
    .join('');
}

function renderAdminBookingsTable() {
  const container = document.getElementById('adminBookingsTableBody');
  if (!container) return;

  if (!AppState.adminBookings || AppState.adminBookings.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state">No mural commission bookings received.</td>
      </tr>
    `;
    return;
  }

  container.innerHTML = AppState.adminBookings
    .map((b) => {
      const customer = b.customerId || {};
      const status = b.status;
      const statusPill = `<span class="status-pill status-${status}">${status}</span>`;

      let actions = '<span style="color: var(--color-text-muted); font-size: 0.8rem;">Decided</span>';
      if (status === 'requested') {
        actions = `
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-forest btn-sm" onclick="setBookingStatus('${b._id}', 'confirmed')">Confirm</button>
            <button class="btn btn-danger btn-sm" onclick="setBookingStatus('${b._id}', 'declined')">Decline</button>
          </div>
        `;
      }

      return `
        <tr>
          <td><strong>${formatDate(b.date)}</strong></td>
          <td>${escapeHtml(customer.email || 'Customer')}</td>
          <td>${b.size} sq ft</td>
          <td>${formatPrice(b.price)}</td>
          <td style="max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(b.address)}">${escapeHtml(b.address)}</td>
          <td>${statusPill}</td>
          <td>${actions}</td>
        </tr>
      `;
    })
    .join('');
}

function renderAdminPotteryTable() {
  const container = document.getElementById('adminPotteryTableBody');
  if (!container) return;

  if (!AppState.adminPottery || AppState.adminPottery.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state">No custom pottery commission requests received.</td>
      </tr>
    `;
    return;
  }

  container.innerHTML = AppState.adminPottery
    .map((p) => {
      const customer = p.customerId || {};
      const itemObj = (AppState.config.potteryItems || []).find((i) => i.id === p.itemId) || { name: p.itemId };
      const glazeObj = (AppState.config.glazes || []).find((g) => g.id === p.glazeId) || { name: p.glazeId };
      const status = p.status;
      const statusPill = `<span class="status-pill status-${status}">${status}</span>`;

      let actions = '<span style="color: var(--color-text-muted); font-size: 0.8rem;">Decided</span>';
      if (status === 'requested') {
        actions = `
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-forest btn-sm" onclick="setPotteryStatus('${p._id}', 'accepted')">Accept</button>
            <button class="btn btn-danger btn-sm" onclick="setPotteryStatus('${p._id}', 'declined')">Decline</button>
          </div>
        `;
      }

      return `
        <tr>
          <td><strong>${escapeHtml(itemObj.name)}</strong></td>
          <td>${escapeHtml(glazeObj.name)}</td>
          <td>${escapeHtml(customer.email || 'Customer')}</td>
          <td>${p.quantity} pcs</td>
          <td>${formatDate(p.neededBy)}</td>
          <td>${statusPill}</td>
          <td>${actions}</td>
        </tr>
      `;
    })
    .join('');
}

async function setBookingStatus(bookingId, status) {
  try {
    const res = await fetch(`/api/bookings/${bookingId}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status }),
    });

    const data = await res.json();

    if (res.ok) {
      showToast(`Mural booking ${status}.`, 'success');
      await loadAdminDashboardData();
    } else {
      showToast(data.error || 'Failed to update booking status.', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

async function setPotteryStatus(potteryId, status) {
  try {
    const res = await fetch(`/api/pottery/${potteryId}/status`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({ status }),
    });

    const data = await res.json();

    if (res.ok) {
      showToast(`Pottery request ${status}.`, 'success');
      await loadAdminDashboardData();
    } else {
      showToast(data.error || 'Failed to update pottery status.', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// ============================================================================
// 11. Authentication Event Handlers
// ============================================================================
function switchAuthTab(tab) {
  const loginForm = document.getElementById('loginFormContainer');
  const registerForm = document.getElementById('registerFormContainer');
  const tabLogin = document.getElementById('authTabLogin');
  const tabRegister = document.getElementById('authTabRegister');

  if (tab === 'login') {
    if (loginForm) loginForm.style.display = 'block';
    if (registerForm) registerForm.style.display = 'none';
    if (tabLogin) tabLogin.classList.add('active');
    if (tabRegister) tabRegister.classList.remove('active');
  } else {
    if (loginForm) loginForm.style.display = 'none';
    if (registerForm) registerForm.style.display = 'block';
    if (tabLogin) tabLogin.classList.remove('active');
    if (tabRegister) tabRegister.classList.add('active');
  }
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.loginEmail.value.trim();
  const password = form.loginPassword.value;

  if (!email || !password) {
    showToast('Please enter both email and password.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (res.ok) {
      setSession(data.token, data.user);
      form.reset();
    } else {
      showToast(data.error || 'Login failed. Please check your credentials.', 'error');
    }
  } catch (err) {
    showToast('Network error during login: ' + err.message, 'error');
  }
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.regEmail.value.trim();
  const password = form.regPassword.value;
  const confirm = form.regPasswordConfirm.value;

  if (!email || !password) {
    showToast('Please enter email and password.', 'error');
    return;
  }

  if (password !== confirm) {
    showToast('Passwords do not match.', 'error');
    return;
  }

  if (password.length < 6) {
    showToast('Password must be at least 6 characters.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (res.ok) {
      setSession(data.token, data.user);
      form.reset();
      showToast('Account created successfully!', 'success');
    } else {
      showToast(data.error || 'Registration failed.', 'error');
    }
  } catch (err) {
    showToast('Network error during registration: ' + err.message, 'error');
  }
}

// ============================================================================
// 12. Tab Switchers for Dashboards
// ============================================================================
function switchCustomerTab(tabName) {
  ['custOrders', 'custBookings', 'custPottery'].forEach((t) => {
    const content = document.getElementById(`${t}Content`);
    const tabBtn = document.getElementById(`${t}TabBtn`);
    if (content) content.style.display = t === tabName ? 'block' : 'none';
    if (tabBtn) tabBtn.classList.toggle('active', t === tabName);
  });
}

function switchAdminTab(tabName) {
  ['adminOrders', 'adminBookings', 'adminPottery'].forEach((t) => {
    const content = document.getElementById(`${t}Content`);
    const tabBtn = document.getElementById(`${t}TabBtn`);
    if (content) content.style.display = t === tabName ? 'block' : 'none';
    if (tabBtn) tabBtn.classList.toggle('active', t === tabName);
  });
}

// ============================================================================
// 13. Initialization Entrypoint
// ============================================================================
async function initApp() {
  await verifyAuthSession();
  await loadInitialData();

  // Attach Form Handlers
  const loginForm = document.getElementById('loginForm');
  if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);

  const registerForm = document.getElementById('registerForm');
  if (registerForm) registerForm.addEventListener('submit', handleRegisterSubmit);

  const muralForm = document.getElementById('muralBookingForm');
  if (muralForm) muralForm.addEventListener('submit', handleMuralBookingSubmit);

  const potteryForm = document.getElementById('potteryCommissionForm');
  if (potteryForm) potteryForm.addEventListener('submit', handlePotteryRequestSubmit);

  const addPaintingForm = document.getElementById('addPaintingForm');
  if (addPaintingForm) addPaintingForm.addEventListener('submit', handleAddPaintingSubmit);

  const editPaintingForm = document.getElementById('editPaintingForm');
  if (editPaintingForm) editPaintingForm.addEventListener('submit', handleEditPaintingSubmit);

  const editPotteryForm = document.getElementById('editPotteryForm');
  if (editPotteryForm) editPotteryForm.addEventListener('submit', handleEditPotterySubmit);
}

// Run safely after DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
