// gallery.js — Design selection page with product URL support

// Hash-based category routing (no server config)
function getCurrentCategory() {
  const hash = window.location.hash.slice(1);
  if (!hash) return 'wedding-tag';
  const match = hash.match(/^\/([^\/]+)$/);
  return match ? match[1] : 'wedding-tag';
}

let currentCategory = 'wedding-tag';
let _loadRequestId = 0;

// Load designs from JSON file
async function loadDesigns(category = 'wedding-tag') {
  const res = await fetch(`/tag-editor/products/${category}.json`);
  if (!res.ok) throw new Error(`Could not load ${category}.json`);
  return res.json();
}

async function switchCategory(category) {
  if (category === currentCategory) return;
  currentCategory = category;

  document.querySelectorAll('.gallery-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === category);
  });

  // Show skeletons immediately — visually cancels the previous load
  const grid = document.getElementById('galleryGrid');
  grid.innerHTML = `
    <div class="gallery-skeleton"></div>
    <div class="gallery-skeleton"></div>
    <div class="gallery-skeleton"></div>
  `;
  thumbnailCache.clear();

  await loadCategory(category);
}

async function loadFontsForDesign(design) {
  const fontFamilies = new Set();
  const fields = design.fields;

  if (fields.name) fontFamilies.add(fields.name.fontFamily.split(',')[0].trim().replace(/["']/g, ''));
  if (fields.date?.enabled !== false && fields.date?.fontFamily) fontFamilies.add(fields.date.fontFamily.split(',')[0].trim().replace(/["']/g, ''));
  if (fields.tagline?.enabled !== false && fields.tagline?.fontFamily) fontFamilies.add(fields.tagline.fontFamily.split(',')[0].trim().replace(/["']/g, ''));
  if (fields.photo?.ampFontFamily) fontFamilies.add(fields.photo.ampFontFamily.split(',')[0].trim().replace(/["']/g, ''));

  for (const family of fontFamilies) {
    await TagRenderer.loadFontFamily(family);
  }
}

const thumbnailCache = new Map();

// Helper to escape HTML
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Build the card shell instantly — no async thumbnail yet
function buildCardShell(design, index) {
  const card = document.createElement('div');
  card.className = 'gallery-card';
  card.style.animationDelay = `${index * 0.08}s`;
  card.dataset.designId = design.id;
  card.style.cursor = 'pointer';
  card.addEventListener('click', (e) => {
    if (!e.target.closest('.btn-select-design')) {
      window.location.href = `editor.html?product=${design.id}&category=${currentCategory}`;
    }
  });

  // Thumbnail placeholder skeleton
  const thumb = document.createElement('div');
  thumb.className = 'gallery-thumb';
  thumb.dataset.thumbFor = design.id;

  const skeletonHeight = Math.round(design.tagDimensions.height * (130 / design.tagDimensions.width));
  const skeleton = document.createElement('div');
  skeleton.style.cssText = `
    width: 130px;
    height: ${skeletonHeight}px;
    border-radius: 10px;
    background: linear-gradient(90deg, #f0e8dc 25%, #e8ddd4 50%, #f0e8dc 75%);
    background-size: 200% 100%;
    animation: shimmer 1.4s infinite;
  `;
  thumb.appendChild(skeleton);

  // Card body — renders immediately
  const body = document.createElement('div');
  body.className = 'gallery-card-body';
  body.innerHTML = `
    <h3 class="gallery-card-name">${escapeHtml(design.name)}</h3>
    <p class="gallery-card-desc">${escapeHtml(design.description)}</p>
    <button class="btn-select-design" onclick="selectDesign('${design.id}')">
      Customize This Design
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="5" y1="12" x2="19" y2="12"/>
        <polyline points="12 5 19 12 12 19"/>
      </svg>
    </button>
  `;

  card.appendChild(thumb);
  card.appendChild(body);
  return card;
}

// Fill in the thumbnail after the card shell is in the DOM
async function loadThumbnailForCard(design, card, requestId) {
  if (requestId !== _loadRequestId) return;

  const thumb = card.querySelector(`[data-thumb-for="${design.id}"]`);
  if (!thumb) return;

  try {
    await loadFontsForDesign(design);
    if (requestId !== _loadRequestId) return;

    let photoDataURL = null;
    const photoField = design.fields.photo;
    if (photoField?.enabled && photoField?.defaultImage) {
      try {
        const res = await fetch(photoField.defaultImage);
        const blob = await res.blob();
        photoDataURL = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.warn('Could not load default photo for thumbnail:', e);
      }
    }

    if (requestId !== _loadRequestId) return;

    const nameField = design.fields.name;
    const sampleValues = {
      name1: nameField.preset?.name1 || '',
      name2: nameField.preset?.name2 || '',
      date: '',
      tagline: nameField.preset?.tagline || design.fields.tagline?.defaultValue || ''
    };

    const tagEl = await window.TagRenderer.buildTagElement(design, sampleValues, photoDataURL);
    if (requestId !== _loadRequestId) return;

    const W = design.tagDimensions.width;
    const scale = 130 / W;
    tagEl.style.transformOrigin = 'top left';
    tagEl.style.transform = `scale(${scale})`;
    tagEl.style.position = 'absolute';
    tagEl.style.top = '0';
    tagEl.style.left = '0';
    tagEl.style.boxShadow = '0 8px 28px rgba(90,60,40,0.22)';

    const wrapper = document.createElement('div');
    wrapper.setAttribute('role', 'img');
    wrapper.setAttribute('aria-label', `${design.name} — ${design.description}`);
    wrapper.style.cssText = `
    width: ${THUMB_W}px;
    height: ${scaledH}px;
    overflow: hidden;
    position: relative;
    border-radius: ${Math.round(16 * scale)}px;
    background: #e8ddd4;
  `;
    wrapper.appendChild(tagEl);

    thumb.innerHTML = '';
    thumb.appendChild(wrapper);
  } catch (err) {
    console.warn(`Thumbnail failed for ${design.id}:`, err);
    // Leave skeleton in place — card is still usable
  }
}

async function loadCategory(category) {
  const requestId = ++_loadRequestId;
  const grid = document.getElementById('galleryGrid');

  try {
    const designs = await loadDesigns(category);
    if (requestId !== _loadRequestId) return;

    // 1. Render ALL card shells immediately — user sees all 12 at once
    grid.innerHTML = '';
    const cards = designs.map((design, index) => {
      const card = buildCardShell(design, index);
      grid.appendChild(card);
      return card;
    });

    // 2. Load thumbnails progressively in the background
    designs.forEach((design, index) => {
      loadThumbnailForCard(design, cards[index], requestId);
    });

  } catch (err) {
    if (requestId !== _loadRequestId) return;
    console.error('Failed to load designs:', err);
    grid.innerHTML = `
      <div class="gallery-error">
        <p>Could not load designs for this category.</p>
        <p style="font-size:0.75rem;opacity:0.6;margin-top:0.5rem">${err.message}</p>
      </div>
    `;
  }
}

function selectDesign(designId) {
  sessionStorage.setItem('selectedDesignId', designId);
  sessionStorage.setItem('selectedCategory', currentCategory);
  window.location.href = `editor.html?product=${designId}&category=${currentCategory}`;
}

async function init() {
  currentCategory = getCurrentCategory();

  // Setup tabs
  document.querySelectorAll('.gallery-tab').forEach(tab => {
    const cat = tab.dataset.category;
    tab.classList.toggle('active', cat === currentCategory);
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.hash = `/${cat}`;
    });
  });

  // React when user changes hash (back/forward or tab click)
  window.addEventListener('hashchange', () => {
    const newCategory = getCurrentCategory();
    switchCategory(newCategory);
  });

  // Load initial category
  await loadCategory(currentCategory);
}

window.selectDesign = selectDesign;
document.addEventListener('DOMContentLoaded', init);