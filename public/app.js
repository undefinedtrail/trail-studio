/**
 * Trail Studio — Clean Tab-Based Frontend Logic
 * Vanilla JavaScript · Modular · Concurrency Safe
 */

// ============================================================================
// 1. Application State
// Open on Sign In page at first; do not auto-login directly
// ============================================================================
const AppState = {
  activeTab: 'auth', // Default to Sign In tab
  token: null,
  currentUser: null,
  config: {
    studioName: 'Trail Studio',
    ratePerSqFt: 150,
    currency: 'INR',
    potteryItems: [
      { id: 'i-01', name: 'Kulhad (clay cup)' },
      { id: 'i-02', name: 'Surahi (water jug)' },
      { id: 'i-03', name: 'Matka (water pot)' },
      { id: 'i-04', name: 'Diya set' },
      { id: 'i-05', name: 'Gamla (planter)' }
    ],
    glazes: [
      { id: 'g-01', name: 'Kumkum Red' },
      { id: 'g-02', name: 'Haldi Yellow' },
      { id: 'g-03', name: 'Mehendi Green' },
      { id: 'g-04', name: 'Indigo Blue' },
      { id: 'g-05', name: 'Sandalwood Beige' },
      { id: 'g-06', name: 'Charcoal Black' }
    ],
    catalogPreview: []
  },
  paintings: [],
  paintingFilter: 'all', // 'all' | 'available' | 'sold'
  
  // Customer Activity
  customerOrders: [],
  customerBookings: [],
  customerPottery: [],

  // Admin Records
  adminOrders: [],
  adminBookings: [],
  adminPottery: [],
};

// Reset any stale session on launch so user starts at Sign In page
try {
  localStorage.removeItem('trail_studio_token');
  localStorage.removeItem('trail_studio_user');
} catch (e) {
  // Ignore storage exceptions
}

// ============================================================================
// 2. Main Tab Switching Controller
// ============================================================================
function switchMainTab(tabName) {
  // Guard access to protected tabs
  if (tabName === 'activity') {
    if (!AppState.token || !AppState.currentUser) {
      showToast('Please sign in to view your activity and orders.', 'info');
      switchMainTab('auth');
      return;
    }
  }

  if (tabName === 'admin') {
    const isAdmin = AppState.currentUser && (AppState.currentUser.role === 'admin' || AppState.currentUser.role === 'studio');
    if (!isAdmin) {
      showToast('Administrator privileges required.', 'error');
      switchMainTab('paintings');
      return;
    }
  }

  AppState.activeTab = tabName;

  // 1. Update navigation tab buttons
  document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  const navBtnSignIn = document.getElementById('navBtnSignIn');
  if (navBtnSignIn) {
    navBtnSignIn.classList.toggle('active', tabName === 'auth');
  }

  // 2. Hide all tab panels, show only target tab panel
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.remove('active');
  });

  const targetPanel = document.getElementById(`tab-${tabName}`);
  if (targetPanel) {
    targetPanel.classList.add('active');
  }

  // 3. Update URL hash without forcing scroll jump
  if (history.replaceState) {
    history.replaceState(null, null, `#${tabName}`);
  } else {
    location.hash = `#${tabName}`;
  }

  // 4. Trigger data refresh for specific tabs
  if (tabName === 'paintings') {
    renderPaintings();
  } else if (tabName === 'murals') {
    loadMuralData();
  } else if (tabName === 'activity') {
    loadCustomerDashboardData();
  } else if (tabName === 'admin') {
    loadAdminDashboardData();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Handle browser Back / Forward buttons via hash change
window.addEventListener('hashchange', () => {
  const hash = location.hash.replace('#', '').trim();
  const validTabs = ['paintings', 'murals', 'pottery', 'activity', 'admin', 'auth'];
  if (validTabs.includes(hash) && hash !== AppState.activeTab) {
    switchMainTab(hash);
  }
});

// ============================================================================
// 3. Authentication & API Helpers
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
  showToast(`Welcome back, ${user.email}!`, 'success');

  // Reload data with new session
  loadInitialData();

  // If customer, switch to activity or paintings; if admin, to admin tab
  if (user.role === 'admin' || user.role === 'studio') {
    switchMainTab('admin');
  } else {
    switchMainTab('paintings');
  }
}

function clearSession() {
  AppState.token = null;
  AppState.currentUser = null;
  localStorage.removeItem('trail_studio_token');
  localStorage.removeItem('trail_studio_user');
  updateNavigationUI();
  renderPaintings();
  showToast('Logged out successfully.', 'info');
  switchMainTab('paintings');
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
      clearSession();
    }
  } catch (err) {
    console.warn('Session verification issue:', err.message);
  } finally {
    updateNavigationUI();
  }
}

function updateNavigationUI() {
  const navAuthGuest = document.getElementById('navAuthGuest');
  const navAuthUser = document.getElementById('navAuthUser');
  const userEmailLabel = document.getElementById('userEmailLabel');
  const userRoleBadge = document.getElementById('userRoleBadge');
  const navBtnAdmin = document.getElementById('navBtnAdmin');
  const adminAddPaintingBtn = document.getElementById('adminAddPaintingBtn');

  const isAdmin = AppState.currentUser && (AppState.currentUser.role === 'admin' || AppState.currentUser.role === 'studio');

  if (AppState.currentUser) {
    if (navAuthGuest) navAuthGuest.style.display = 'none';
    if (navAuthUser) navAuthUser.style.display = 'flex';
    if (userEmailLabel) userEmailLabel.textContent = AppState.currentUser.email;

    if (userRoleBadge) {
      userRoleBadge.textContent = isAdmin ? 'Admin' : 'Customer';
      userRoleBadge.className = `role-pill ${isAdmin ? 'role-admin' : 'role-customer'}`;
    }

    if (navBtnAdmin) navBtnAdmin.style.display = isAdmin ? 'inline-block' : 'none';
    if (adminAddPaintingBtn) adminAddPaintingBtn.style.display = isAdmin ? 'inline-block' : 'none';
  } else {
    if (navAuthGuest) navAuthGuest.style.display = 'block';
    if (navAuthUser) navAuthUser.style.display = 'none';
    if (navBtnAdmin) navBtnAdmin.style.display = 'none';
    if (adminAddPaintingBtn) adminAddPaintingBtn.style.display = 'none';
  }
}

// ============================================================================
// 4. UI Feedback: Toasts, Modals & Formatters
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
      toast.style.transition = 'opacity 0.25s ease';
      setTimeout(() => toast.remove(), 250);
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
  } else {
    input.type = 'password';
    btn.innerHTML = '👁️';
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

// Close modals on Escape key or backdrop click
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach((m) => m.classList.remove('active'));
  }
});

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});

// ============================================================================
// 5. Config & Initial Data Loading
// ============================================================================
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const data = await res.json();
      AppState.config = { ...AppState.config, ...data };
      setupMuralFormConstraints();
      setupPotteryOptions();
    }
  } catch (err) {
    console.warn('Config load note:', err.message);
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
    // When guest: if config has catalogPreview, use it for public browsing!
    if (Array.isArray(AppState.config.catalogPreview) && AppState.config.catalogPreview.length > 0) {
      AppState.paintings = AppState.config.catalogPreview.map((p) => ({
        _id: p.id,
        code: p.id,
        title: p.title,
        artist: p.artist,
        price: p.price,
        imageUrl: p.imageUrl,
        isAvailable: p.status === 'available',
        description: p.description
      }));
    }
    renderPaintings();
  }
}

// ============================================================================
// 6. Tab 1: Paintings Gallery (Browse, Buy, Add, Edit)
// ============================================================================
async function loadPaintings() {
  if (!AppState.token) return;

  try {
    const res = await fetch('/api/paintings', { headers: getAuthHeaders() });
    if (res.ok) {
      AppState.paintings = await res.json();
      renderPaintings();
    } else if (res.status === 401) {
      clearSession();
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

  let list = AppState.paintings;

  if (AppState.paintingFilter === 'available') {
    list = list.filter((p) => p.isAvailable);
  } else if (AppState.paintingFilter === 'sold') {
    list = list.filter((p) => !p.isAvailable);
  }

  if (list.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-state-icon">🖼️</div>
        <h4>No Paintings Match Filter</h4>
        <p>Try switching to "All Works" to view the complete folk art collection.</p>
      </div>
    `;
    return;
  }

  const isAdmin = AppState.currentUser && (AppState.currentUser.role === 'admin' || AppState.currentUser.role === 'studio');
  const isGuest = !AppState.token || !AppState.currentUser;

  grid.innerHTML = list
    .map((p) => {
      const isAvail = p.isAvailable;
      const badgeClass = isAvail ? 'badge-available' : 'badge-sold';
      const badgeText = isAvail ? 'Available' : 'Sold &amp; Archived';

      let actionHtml = '';

      if (isGuest) {
        actionHtml = isAvail
          ? `<button type="button" class="btn btn-primary btn-sm" onclick="switchMainTab('auth')">Sign in to Purchase</button>`
          : `<button type="button" class="btn btn-secondary btn-sm" disabled>Sold Out</button>`;
      } else if (isAdmin) {
        actionHtml = isAvail
          ? `<button type="button" class="btn btn-secondary btn-sm" onclick="openEditPaintingModal('${p._id}')">Edit Details</button>`
          : `<span class="status-pill status-declined">Sold (Locked)</span>`;
      } else {
        // Logged-in customer
        actionHtml = isAvail
          ? `<button type="button" class="btn btn-primary btn-sm" onclick="buyPainting('${p._id}', '${escapeHtml(p.title)}')">Purchase Painting</button>`
          : `<button type="button" class="btn btn-secondary btn-sm" disabled>Sold Out</button>`;
      }

      const imgPath = p.imageUrl ? p.imageUrl.replace(/^\//, '') : 'images/p-001.jpg';

      return `
        <article class="artwork-card" id="card-${p._id}">
          <div class="artwork-img-wrapper">
            <img src="${escapeHtml(imgPath)}" alt="${escapeHtml(p.title)}" class="artwork-img" loading="lazy" onerror="this.src='images/p-001.jpg'">
            <span class="artwork-badge ${badgeClass}">${badgeText}</span>
          </div>
          <div class="artwork-body">
            <div class="artwork-code">${escapeHtml(p.code || 'FOLK ART')}</div>
            <h3 class="artwork-title">${escapeHtml(p.title)}</h3>
            <div class="artwork-artist">By ${escapeHtml(p.artist || 'Trail Studio Artist')}</div>
            <p class="artwork-desc">${escapeHtml(p.description || 'Authentic traditional Indian artwork.')}</p>
            <div class="artwork-footer">
              <div class="artwork-price">${formatPrice(p.price)}</div>
              <div>${actionHtml}</div>
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
      showToast(`Congratulations! You acquired "${paintingTitle}".`, 'success');
      await loadPaintings();
      await loadCustomerDashboardData();
    } else {
      showToast(data.error || 'Could not complete purchase.', 'error');
      await loadPaintings();
    }
  } catch (err) {
    showToast('Purchase error: ' + err.message, 'error');
  }
}

// Add Painting (Admin Action)
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
    showToast('Valid artwork title and price are required.', 'error');
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
      showToast(`Artwork "${title}" added to gallery.`, 'success');
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

// Edit Painting (Admin Action)
let currentEditPaintingId = null;

function openEditPaintingModal(paintingId) {
  const p = AppState.paintings.find((x) => x._id === paintingId);
  if (!p) return;

  currentEditPaintingId = paintingId;
  const form = document.getElementById('editPaintingForm');
  form.editTitle.value = p.title;
  form.editArtist.value = p.artist || '';
  form.editPrice.value = p.price;
  form.editImageUrl.value = p.imageUrl || '';
  form.editDescription.value = p.description || '';

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
      showToast('Painting details updated.', 'success');
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
// 7. Tab 2: Wall Murals Booking Flow
// ============================================================================
let reservedMuralDates = [];

function formatDateForInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function setupMuralFormConstraints() {
  const dateInput = document.getElementById('muralDate');
  const sizeInput = document.getElementById('muralSize');

  if (dateInput) {
    const minD = new Date();
    minD.setDate(minD.getDate() + 7);
    const maxD = new Date();
    maxD.setDate(maxD.getDate() + 90);

    dateInput.min = formatDateForInput(minD);
    dateInput.max = formatDateForInput(maxD);
    dateInput.addEventListener('change', checkMuralDateAvailability);
  }

  if (sizeInput) {
    sizeInput.addEventListener('input', calculateMuralEstimate);
  }
}

async function loadReservedMuralDates() {
  if (!AppState.token) return;
  try {
    const res = await fetch('/api/bookings/reserved', { headers: getAuthHeaders() });
    if (res.ok) {
      reservedMuralDates = await res.json();
      updateReservedDatesUI();
    }
  } catch (err) {
    // Ignore error
  }
}

function updateReservedDatesUI() {
  const hintEl = document.getElementById('muralReservedDatesHint');
  if (!hintEl) return;
  if (reservedMuralDates.length === 0) {
    hintEl.textContent = 'All calendar dates between 7 and 90 days out are currently open.';
  } else {
    const formatted = reservedMuralDates.map((d) => formatDate(d)).join(', ');
    hintEl.innerHTML = `<strong>Already booked dates:</strong> ${escapeHtml(formatted)}`;
  }
}

function checkMuralDateAvailability() {
  const dateInput = document.getElementById('muralDate');
  const msgEl = document.getElementById('muralDateStatusMsg');
  if (!dateInput || !msgEl) return;

  const val = dateInput.value;
  if (!val) {
    msgEl.textContent = '';
    return;
  }

  if (reservedMuralDates.includes(val)) {
    msgEl.innerHTML = `<span style="color: #b33927; font-weight: 600;">⚠️ ${formatDate(val)} is already booked. Please choose another date.</span>`;
  } else {
    msgEl.innerHTML = `<span style="color: #175a2d; font-weight: 600;">✓ ${formatDate(val)} is available!</span>`;
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
      formulaDisplay.textContent = 'Enter wall size between 10 and 500 sq ft';
    }
  }
}

async function handleMuralBookingSubmit(e) {
  e.preventDefault();

  if (!AppState.token) {
    showToast('Please sign in to book a mural.', 'info');
    switchMainTab('auth');
    return;
  }

  const dateInput = document.getElementById('muralDate');
  const sizeInput = document.getElementById('muralSize');
  const addressInput = document.getElementById('muralAddress');

  const date = dateInput ? dateInput.value : '';
  const size = sizeInput ? Number(sizeInput.value) : 0;
  const address = addressInput ? addressInput.value.trim() : '';

  if (!date || !size || !address) {
    showToast('Please fill out all booking details.', 'error');
    return;
  }

  if (size < 10 || size > 500) {
    showToast('Wall size must be between 10 and 500 sq ft.', 'error');
    return;
  }

  if (reservedMuralDates.includes(date)) {
    showToast('This date is already booked. Please pick another date.', 'error');
    return;
  }

  const submitBtn = document.getElementById('muralSubmitBtn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting Booking...';
  }

  try {
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ date, size, address }),
    });

    const data = await res.json();

    if (res.ok) {
      showToast('Wall mural booking submitted successfully!', 'success');
      e.target.reset();
      calculateMuralEstimate();
      const msgEl = document.getElementById('muralDateStatusMsg');
      if (msgEl) msgEl.textContent = '';

      if (AppState.currentUser && (AppState.currentUser.role === 'admin' || AppState.currentUser.role === 'studio')) {
        await loadAdminDashboardData();
      } else {
        await loadCustomerDashboardData();
      }
      await loadReservedMuralDates();
      renderMuralTabBookings();
    } else {
      showToast(data.error || 'Failed to submit mural booking.', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Book Wall Mural';
    }
  }
}

async function loadMuralData() {
  setupMuralFormConstraints();
  await loadReservedMuralDates();
  if (AppState.token) {
    const isAdmin = AppState.currentUser && (AppState.currentUser.role === 'admin' || AppState.currentUser.role === 'studio');
    if (isAdmin) {
      await loadAdminDashboardData();
    } else {
      await loadCustomerDashboardData();
    }
  }
  renderMuralTabBookings();
}

function renderMuralTabBookings() {
  const tbody = document.getElementById('muralTabBookingsBody');
  const heading = document.getElementById('muralListHeading');
  const theadRow = document.getElementById('muralTabTableHeader');
  if (!tbody) return;

  if (!AppState.token || !AppState.currentUser) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Please sign in to view your mural bookings.</td></tr>`;
    return;
  }

  const isAdmin = AppState.currentUser.role === 'admin' || AppState.currentUser.role === 'studio';

  if (isAdmin) {
    if (heading) heading.textContent = 'All Studio Mural Bookings (Admin)';
    if (theadRow) {
      theadRow.innerHTML = `
        <th>Date</th>
        <th>Customer</th>
        <th>Size</th>
        <th>Price</th>
        <th>Address</th>
        <th>Status</th>
        <th>Decision</th>
      `;
    }

    if (!AppState.adminBookings || AppState.adminBookings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No mural bookings received.</td></tr>`;
      return;
    }

    tbody.innerHTML = AppState.adminBookings
      .map((b) => {
        const c = b.customerId || {};
        const status = b.status;
        const statusPill = `<span class="status-pill status-${status}">${status}</span>`;

        let decision = '<span style="color: var(--text-muted); font-size: 0.8rem;">Decided</span>';
        if (status === 'requested') {
          decision = `
            <div style="display: flex; gap: 6px;">
              <button type="button" class="btn btn-forest btn-sm" onclick="setBookingStatus('${b._id}', 'confirmed')">Confirm</button>
              <button type="button" class="btn btn-danger btn-sm" onclick="setBookingStatus('${b._id}', 'declined')">Decline</button>
            </div>
          `;
        }

        return `
          <tr>
            <td><strong>${formatDate(b.date)}</strong></td>
            <td>${escapeHtml(c.email || 'Customer')}</td>
            <td>${b.size} sq ft</td>
            <td>${formatPrice(b.price)}</td>
            <td style="max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(b.address)}">${escapeHtml(b.address)}</td>
            <td>${statusPill}</td>
            <td>${decision}</td>
          </tr>
        `;
      })
      .join('');
  } else {
    // Customer
    if (heading) heading.textContent = 'Your Mural Bookings';
    if (theadRow) {
      theadRow.innerHTML = `
        <th>Execution Date</th>
        <th>Wall Size</th>
        <th>Total Price</th>
        <th>Site Address</th>
        <th>Status</th>
        <th>Action</th>
      `;
    }

    if (!AppState.customerBookings || AppState.customerBookings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No wall mural bookings yet. Use the form above to book your first mural.</td></tr>`;
      return;
    }

    tbody.innerHTML = AppState.customerBookings
      .map((b) => {
        const status = b.status;
        const statusPill = `<span class="status-pill status-${status}">${status}</span>`;
        const canCancel = status === 'requested' || status === 'confirmed';

        const action = canCancel
          ? `<button type="button" class="btn btn-danger btn-sm" onclick="cancelBooking('${b._id}')">Cancel</button>`
          : '<span style="color: var(--text-muted); font-size: 0.8rem;">Locked</span>';

        return `
          <tr>
            <td><strong>${formatDate(b.date)}</strong></td>
            <td>${b.size} sq ft</td>
            <td>${formatPrice(b.price)}</td>
            <td style="max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(b.address)}">${escapeHtml(b.address)}</td>
            <td>${statusPill}</td>
            <td>${action}</td>
          </tr>
        `;
      })
      .join('');
  }
}

// ============================================================================
// 8. Tab 3: Custom Pottery Flow (Visual Form Selection)
// ============================================================================
function setupPotteryOptions() {
  const dateInput = document.getElementById('potteryNeededBy');
  if (dateInput) {
    const minD = new Date();
    minD.setDate(minD.getDate() + 14);
    dateInput.min = formatDateForInput(minD);
  }
  updatePotterySummary();
}

function selectPotteryItem(itemId, itemName) {
  const input = document.getElementById('selectedPotteryItem');
  const label = document.getElementById('selectedItemLabel');
  if (input) input.value = itemId;
  if (label) label.textContent = itemName;

  document.querySelectorAll('.item-select-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.id === itemId);
  });

  updatePotterySummary();
}

function selectPotteryGlaze(glazeId, glazeName) {
  const input = document.getElementById('selectedPotteryGlaze');
  const label = document.getElementById('selectedGlazeLabel');
  if (input) input.value = glazeId;
  if (label) label.textContent = glazeName;

  document.querySelectorAll('.glaze-select-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.id === glazeId);
  });

  updatePotterySummary();
}

function updatePotterySummary() {
  const readout = document.getElementById('potterySummaryReadout');
  const itemInput = document.getElementById('selectedPotteryItem');
  const glazeInput = document.getElementById('selectedPotteryGlaze');
  const qtyInput = document.getElementById('potteryQuantity');

  if (!readout || !itemInput || !glazeInput) return;

  const itemObj = AppState.config.potteryItems.find((i) => i.id === itemInput.value) || { name: 'Vessel' };
  const glazeObj = AppState.config.glazes.find((g) => g.id === glazeInput.value) || { name: 'Glaze' };
  const qty = qtyInput ? qtyInput.value : 1;

  readout.textContent = `${qty}x ${itemObj.name} · ${glazeObj.name} · Min. 14 days delivery`;
}

// Quantity change listener
document.addEventListener('input', (e) => {
  if (e.target.id === 'potteryQuantity') {
    updatePotterySummary();
  }
});

async function handlePotteryRequestSubmit(e) {
  e.preventDefault();

  if (!AppState.token) {
    showToast('Please sign in as a customer to order pottery.', 'info');
    switchMainTab('auth');
    return;
  }

  if (AppState.currentUser && (AppState.currentUser.role === 'admin' || AppState.currentUser.role === 'studio')) {
    showToast('Administrators cannot create customer pottery requests.', 'error');
    return;
  }

  const form = e.target;
  const itemId = document.getElementById('selectedPotteryItem').value;
  const glazeId = document.getElementById('selectedPotteryGlaze').value;
  const quantity = Number(form.potteryQuantity.value);
  const neededBy = form.potteryNeededBy.value;

  if (!itemId || !glazeId || !quantity || !neededBy) {
    showToast('Please select vessel, glaze, quantity, and needed date.', 'error');
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
      showToast('Custom pottery request submitted successfully!', 'success');
      form.reset();
      selectPotteryItem('i-01', 'Kulhad (clay cup)');
      selectPotteryGlaze('g-01', 'Kumkum Red');
      await loadCustomerDashboardData();
      switchMainTab('activity');
      switchCustomerSubtab('pottery');
    } else {
      showToast(data.error || 'Failed to submit pottery request.', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// ============================================================================
// 9. Tab 4: My Activity Controller (Subtab Switching & Table Rendering)
// ============================================================================
function switchCustomerSubtab(subtabName) {
  ['orders', 'murals', 'pottery'].forEach((s) => {
    const content = document.getElementById(`subtabContent${capitalize(s)}`);
    const btn = document.getElementById(`subtabBtn${capitalize(s)}`);
    if (content) content.style.display = s === subtabName ? 'block' : 'none';
    if (btn) btn.classList.toggle('active', s === subtabName);
  });
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

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

    renderCustomerOrders();
    renderCustomerBookings();
    renderCustomerPottery();
  } catch (err) {
    console.error('Customer activity error:', err.message);
  }
}

function renderCustomerOrders() {
  const tbody = document.getElementById('custOrdersTableBody');
  if (!tbody) return;

  if (!AppState.customerOrders || AppState.customerOrders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No painting orders placed yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = AppState.customerOrders
    .map((o) => {
      const p = o.paintingId || {};
      const isPlaced = o.status === 'placed';
      const statusPill = isPlaced
        ? '<span class="status-pill status-placed">Placed</span>'
        : '<span class="status-pill status-cancelled">Cancelled</span>';

      const action = isPlaced
        ? `<button type="button" class="btn btn-danger btn-sm" onclick="cancelOrder('${o._id}')">Cancel Order</button>`
        : '<span style="color: var(--text-muted); font-size: 0.8rem;">None</span>';

      return `
        <tr>
          <td><strong>${escapeHtml(p.title || 'Original Artwork')}</strong><div style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(p.code || '')}</div></td>
          <td>${escapeHtml(p.artist || 'Trail Studio Artist')}</td>
          <td>${formatPrice(p.price)}</td>
          <td>${formatDate(o.createdAt)}</td>
          <td>${statusPill}</td>
          <td>${action}</td>
        </tr>
      `;
    })
    .join('');
}

function renderCustomerBookings() {
  const tbody = document.getElementById('custBookingsTableBody');
  if (!tbody) return;

  if (!AppState.customerBookings || AppState.customerBookings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No wall mural bookings yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = AppState.customerBookings
    .map((b) => {
      const status = b.status;
      const statusPill = `<span class="status-pill status-${status}">${status}</span>`;
      const canCancel = status === 'requested' || status === 'confirmed';

      const action = canCancel
        ? `<button type="button" class="btn btn-danger btn-sm" onclick="cancelBooking('${b._id}')">Cancel</button>`
        : '<span style="color: var(--text-muted); font-size: 0.8rem;">Locked</span>';

      return `
        <tr>
          <td><strong>${formatDate(b.date)}</strong></td>
          <td>${b.size} sq ft</td>
          <td>${formatPrice(b.price)}</td>
          <td style="max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(b.address)}">${escapeHtml(b.address)}</td>
          <td>${statusPill}</td>
          <td>${action}</td>
        </tr>
      `;
    })
    .join('');
}

function renderCustomerPottery() {
  const tbody = document.getElementById('custPotteryTableBody');
  if (!tbody) return;

  if (!AppState.customerPottery || AppState.customerPottery.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No custom pottery requests submitted yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = AppState.customerPottery
    .map((req) => {
      const itemObj = AppState.config.potteryItems.find((i) => i.id === req.itemId) || { name: req.itemId };
      const glazeObj = AppState.config.glazes.find((g) => g.id === req.glazeId) || { name: req.glazeId };
      const status = req.status;
      const statusPill = `<span class="status-pill status-${status}">${status}</span>`;

      let action = '<span style="color: var(--text-muted); font-size: 0.8rem;">Locked</span>';
      if (status === 'requested') {
        action = `
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="openEditPotteryModal('${req._id}')">Edit</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="cancelPotteryRequest('${req._id}')">Cancel</button>
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
          <td>${action}</td>
        </tr>
      `;
    })
    .join('');
}

// Cancel Customer Order
async function cancelOrder(orderId) {
  if (!confirm('Cancel this painting purchase? The artwork will immediately become available again for others to acquire.')) {
    return;
  }

  try {
    const res = await fetch(`/api/orders/${orderId}/cancel`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
    });

    const data = await res.json();

    if (res.ok) {
      showToast('Order cancelled. Artwork returned to available stock.', 'success');
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
  if (!confirm('Cancel this wall mural booking? The reserved date will be released.')) {
    return;
  }

  try {
    const res = await fetch(`/api/bookings/${bookingId}/cancel`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
    });

    const data = await res.json();

    if (res.ok) {
      showToast('Mural booking cancelled and date released.', 'info');
      await Promise.all([
        loadCustomerDashboardData(),
        loadReservedMuralDates()
      ]);
      renderMuralTabBookings();
    } else {
      showToast(data.error || 'Failed to cancel booking.', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// Cancel Customer Pottery
async function cancelPotteryRequest(potteryId) {
  if (!confirm('Cancel this custom pottery request?')) {
    return;
  }

  try {
    const res = await fetch(`/api/pottery/${potteryId}/cancel`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
    });

    const data = await res.json();

    if (res.ok) {
      showToast('Pottery request cancelled.', 'info');
      await loadCustomerDashboardData();
    } else {
      showToast(data.error || 'Failed to cancel pottery request.', 'error');
    }
  } catch (err) {
    showToast('Network error: ' + err.message, 'error');
  }
}

// Edit Customer Pottery
let currentEditPotteryId = null;

function openEditPotteryModal(potteryId) {
  const req = AppState.customerPottery.find((p) => p._id === potteryId);
  if (!req) return;

  currentEditPotteryId = potteryId;
  const form = document.getElementById('editPotteryForm');

  form.editPotteryItem.innerHTML = AppState.config.potteryItems.map((i) => `
    <option value="${escapeHtml(i.id)}" ${i.id === req.itemId ? 'selected' : ''}>${escapeHtml(i.name)}</option>
  `).join('');

  form.editPotteryGlaze.innerHTML = AppState.config.glazes.map((g) => `
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
      showToast('Pottery request updated.', 'success');
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
// 10. Tab 5: Studio Admin Dashboard (Subtab Switching & Table Rendering)
// ============================================================================
function switchAdminSubtab(subtabName) {
  ['inventory', 'orders', 'murals', 'pottery'].forEach((s) => {
    const content = document.getElementById(`adminSubtabContent${capitalize(s)}`);
    const btn = document.getElementById(`adminSubtabBtn${capitalize(s)}`);
    if (content) content.style.display = s === subtabName ? 'block' : 'none';
    if (btn) btn.classList.toggle('active', s === subtabName);
  });
}

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

    renderAdminInventory();
    renderAdminOrders();
    renderAdminBookings();
    renderAdminPottery();
  } catch (err) {
    console.error('Admin data error:', err.message);
  }
}

function renderAdminInventory() {
  const tbody = document.getElementById('adminInventoryTableBody');
  if (!tbody) return;

  tbody.innerHTML = AppState.paintings
    .map((p) => {
      const isAvail = p.isAvailable;
      const statusPill = isAvail
        ? '<span class="status-pill status-placed">Available</span>'
        : '<span class="status-pill status-cancelled">Sold &amp; Archived</span>';

      const action = isAvail
        ? `<button type="button" class="btn btn-secondary btn-sm" onclick="openEditPaintingModal('${p._id}')">Edit</button>`
        : '<span style="color: var(--text-muted); font-size: 0.8rem;">Locked</span>';

      return `
        <tr>
          <td><strong>${escapeHtml(p.title)}</strong><div style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(p.code || '')}</div></td>
          <td>${escapeHtml(p.artist || 'Trail Studio Artist')}</td>
          <td>${formatPrice(p.price)}</td>
          <td>${statusPill}</td>
          <td>${action}</td>
        </tr>
      `;
    })
    .join('');
}

function renderAdminOrders() {
  const tbody = document.getElementById('adminOrdersTableBody');
  if (!tbody) return;

  if (!AppState.adminOrders || AppState.adminOrders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No customer orders recorded.</td></tr>`;
    return;
  }

  tbody.innerHTML = AppState.adminOrders
    .map((o) => {
      const p = o.paintingId || {};
      const c = o.customerId || {};
      const statusPill = o.status === 'placed'
        ? '<span class="status-pill status-placed">Placed</span>'
        : '<span class="status-pill status-cancelled">Cancelled</span>';

      return `
        <tr>
          <td><strong>${escapeHtml(p.title || 'Painting')}</strong></td>
          <td>${escapeHtml(c.email || 'Customer')}</td>
          <td>${formatPrice(p.price)}</td>
          <td>${formatDate(o.createdAt)}</td>
          <td>${statusPill}</td>
        </tr>
      `;
    })
    .join('');
}

function renderAdminBookings() {
  const tbody = document.getElementById('adminBookingsTableBody');
  if (!tbody) return;

  if (!AppState.adminBookings || AppState.adminBookings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No mural bookings received.</td></tr>`;
    return;
  }

  tbody.innerHTML = AppState.adminBookings
    .map((b) => {
      const c = b.customerId || {};
      const status = b.status;
      const statusPill = `<span class="status-pill status-${status}">${status}</span>`;

      let decision = '<span style="color: var(--text-muted); font-size: 0.8rem;">Decided</span>';
      if (status === 'requested') {
        decision = `
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn btn-forest btn-sm" onclick="setBookingStatus('${b._id}', 'confirmed')">Confirm</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="setBookingStatus('${b._id}', 'declined')">Decline</button>
          </div>
        `;
      }

      return `
        <tr>
          <td><strong>${formatDate(b.date)}</strong></td>
          <td>${escapeHtml(c.email || 'Customer')}</td>
          <td>${b.size} sq ft</td>
          <td>${formatPrice(b.price)}</td>
          <td style="max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(b.address)}">${escapeHtml(b.address)}</td>
          <td>${statusPill}</td>
          <td>${decision}</td>
        </tr>
      `;
    })
    .join('');
}

function renderAdminPottery() {
  const tbody = document.getElementById('adminPotteryTableBody');
  if (!tbody) return;

  if (!AppState.adminPottery || AppState.adminPottery.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No custom pottery requests received.</td></tr>`;
    return;
  }

  tbody.innerHTML = AppState.adminPottery
    .map((p) => {
      const c = p.customerId || {};
      const itemObj = AppState.config.potteryItems.find((i) => i.id === p.itemId) || { name: p.itemId };
      const glazeObj = AppState.config.glazes.find((g) => g.id === p.glazeId) || { name: p.glazeId };
      const status = p.status;
      const statusPill = `<span class="status-pill status-${status}">${status}</span>`;

      let decision = '<span style="color: var(--text-muted); font-size: 0.8rem;">Decided</span>';
      if (status === 'requested') {
        decision = `
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn btn-forest btn-sm" onclick="setPotteryStatus('${p._id}', 'accepted')">Accept</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="setPotteryStatus('${p._id}', 'declined')">Decline</button>
          </div>
        `;
      }

      return `
        <tr>
          <td><strong>${escapeHtml(itemObj.name)}</strong></td>
          <td>${escapeHtml(glazeObj.name)}</td>
          <td>${escapeHtml(c.email || 'Customer')}</td>
          <td>${p.quantity} pcs</td>
          <td>${formatDate(p.neededBy)}</td>
          <td>${statusPill}</td>
          <td>${decision}</td>
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
      await Promise.all([
        loadAdminDashboardData(),
        loadReservedMuralDates()
      ]);
      renderMuralTabBookings();
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
// 11. Tab 6: Authentication Form Handlers
// ============================================================================
function switchAuthTab(tab) {
  const loginWrap = document.getElementById('authLoginFormWrap');
  const registerWrap = document.getElementById('authRegisterFormWrap');
  const btnLogin = document.getElementById('authTabBtnLogin');
  const btnRegister = document.getElementById('authTabBtnRegister');

  if (tab === 'login') {
    if (loginWrap) loginWrap.style.display = 'block';
    if (registerWrap) registerWrap.style.display = 'none';
    if (btnLogin) btnLogin.classList.add('active');
    if (btnRegister) btnRegister.classList.remove('active');
  } else {
    if (loginWrap) loginWrap.style.display = 'none';
    if (registerWrap) registerWrap.style.display = 'block';
    if (btnLogin) btnLogin.classList.remove('active');
    if (btnRegister) btnRegister.classList.add('active');
  }
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.loginEmail.value.trim();
  const password = form.loginPassword.value;

  if (!email || !password) {
    showToast('Email and password are required.', 'error');
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
      showToast(data.error || 'Invalid credentials.', 'error');
    }
  } catch (err) {
    showToast('Login error: ' + err.message, 'error');
  }
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.regEmail.value.trim();
  const password = form.regPassword.value;
  const confirm = form.regPasswordConfirm.value;

  if (!email || !password) {
    showToast('All fields are required.', 'error');
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
      showToast('Account registered successfully!', 'success');
    } else {
      showToast(data.error || 'Registration failed.', 'error');
    }
  } catch (err) {
    showToast('Registration error: ' + err.message, 'error');
  }
}

// ============================================================================
// 12. App Initialization
// Open on Sign In page at first; do not auto-login directly
// ============================================================================
async function initApp() {
  updateNavigationUI();
  await loadInitialData();

  // Route to initial hash if explicitly specified in URL, otherwise open Sign In page
  const initialHash = location.hash.replace('#', '').trim();
  const validTabs = ['paintings', 'murals', 'pottery', 'activity', 'admin', 'auth'];
  if (initialHash && validTabs.includes(initialHash)) {
    switchMainTab(initialHash);
  } else {
    switchMainTab('auth');
  }

  // Attach Form Event Listeners
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

// Safe bootstrap
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
