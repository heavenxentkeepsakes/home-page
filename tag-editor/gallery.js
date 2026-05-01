// gallery.js — Design selection page with product URL support

// Hash‑based category routing (no server config)
function getCurrentCategory() {
  const hash = window.location.hash.slice(1); // "#/wedding-tag" → "/wedding-tag"
  if (!hash) return 'wedding-tag';             // default
  const match = hash.match(/^\/([^\/]+)$/);
  return match ? match[1] : 'wedding-tag';
}

let currentCategory = 'wedding-tag';

// Load designs from JSON file
async function loadDesigns(category = 'wedding-tag') {
  const res = await fetch(`/tag-editor/products/${category}.json`);
  if (!res.ok) throw new Error(`Could not load ${category}.json`);
  return res.json();
}

async function switchCategory(category) {
  if (category === currentCategory) return;
  currentCategory = category;

  // Update active tab
  document.querySelectorAll('.gallery-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === category);
  });

  // Show skeletons while loading
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
  
  // Load fonts sequentially
  for (const family of fontFamilies) {
    await TagRenderer.loadFontFamily(family);
  }
}

// Intersection Observer for lazy loading thumbnails
const thumbnailCache = new Map();

async function buildThumbnailTag(design, isVisible = true) {
  const THUMB_W = 130;
  const W = design.tagDimensions.width;
  const scale = THUMB_W / W;
  const scaledH = Math.round(design.tagDimensions.height * scale);

  const wrapper = document.createElement('div');
  wrapper.style.cssText = `
    width: ${THUMB_W}px;
    height: ${scaledH}px;
    overflow: hidden;
    position: relative;
    border-radius: ${Math.round(16 * scale)}px;
    background: #e8ddd4;
  `;

  // Add loading placeholder
  const placeholder = document.createElement('div');
  placeholder.style.cssText = `
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f0e8dc;
    color: #8b6f5e;
    font-size: 12px;
  `;
  placeholder.textContent = 'Loading...';
  wrapper.appendChild(placeholder);

  if (!isVisible) {
    // Store for later loading
    thumbnailCache.set(design.id, { wrapper, design, placeholder });
    return wrapper;
  }

  await renderThumbnailContent(wrapper, design, placeholder);
  return wrapper;
}

async function renderThumbnailContent(wrapper, design, placeholder) {
  try {
    // Load fonts for this design before rendering
    await loadFontsForDesign(design);

    // Load default photo if design has photo enabled
    let photoDataURL = null;
    const photoField = design.fields.photo;
    if (photoField && photoField.enabled && photoField.defaultImage) {
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

    // Use preset name1 / name2 from JSON; fall back to defaultValue if needed
    const nameField = design.fields.name;
    const name1 = nameField.preset?.name1 || '';
    const name2 = nameField.preset?.name2 || '';
    const defaultTagline = nameField.preset?.tagline
      || design.fields.tagline?.defaultValue
      || 'Forever starts today';

    const sampleValues = { name1, name2, date: '', tagline: defaultTagline };
    console.log("sampleValues:", sampleValues); // DEBUG
    const tagEl = await window.TagRenderer.buildTagElement(design, sampleValues, photoDataURL);

    const W = design.tagDimensions.width;
    const scale = 130 / W;

    tagEl.style.transformOrigin = 'top left';
    tagEl.style.transform = `scale(${scale})`;
    tagEl.style.position = 'absolute';
    tagEl.style.top = '0';
    tagEl.style.left = '0';
    tagEl.style.boxShadow = '0 8px 28px rgba(90,60,40,0.22)';

    // Remove placeholder and add tag
    wrapper.innerHTML = '';
    wrapper.appendChild(tagEl);
  } catch (err) {
    console.warn(`Failed to render thumbnail for ${design.id}:`, err);
    placeholder.textContent = 'Failed to load';
    placeholder.style.color = '#c4956a';
  }
}

// Lazy load thumbnails when they come into view
function setupLazyLoading(cards, designs) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const card = entry.target;
        const designId = card.dataset.designId;
        const design = designs.find(d => d.id === designId);
        const thumbnailData = thumbnailCache.get(designId);

        if (thumbnailData && thumbnailData.wrapper) {
          renderThumbnailContent(thumbnailData.wrapper, design, thumbnailData.placeholder);
          thumbnailCache.delete(designId);
        }

        observer.unobserve(card);
      }
    });
  }, { rootMargin: '100px' });

  cards.forEach(card => observer.observe(card));
}

async function buildCard(design, index) {
  const card = document.createElement('div');
  card.className = 'gallery-card';
  card.style.animationDelay = `${index * 0.08}s`;
  card.dataset.designId = design.id;

  // Make entire card clickable for direct navigation
  card.style.cursor = 'pointer';
  card.addEventListener('click', (e) => {
    // Don't trigger if clicking the button (it has its own handler)
    if (!e.target.closest('.btn-select-design')) {
      window.location.href = `editor.html?product=${design.id}&category=${currentCategory}`;
    }
  });

  // Thumbnail area
  const thumb = document.createElement('div');
  thumb.className = 'gallery-thumb';
  const isVisible = index < 4;
  thumb.appendChild(await buildThumbnailTag(design, isVisible));

  // Card body
  const photoEnabled = design.fields.photo && design.fields.photo.enabled;
  const fontName = design.fields.name.fontFamily.split(',')[0];

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

// Helper to escape HTML
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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

  // Also react when user changes hash (back/forward or tab click)
  window.addEventListener('hashchange', () => {
    const newCategory = getCurrentCategory();
    switchCategory(newCategory);
  });

  // Load initial category
  await loadCategory(currentCategory);
}

async function loadCategory(category) {
  const grid = document.getElementById('galleryGrid');
  try {
    const designs = await loadDesigns(category);
    grid.innerHTML = '';
    const cards = [];
    for (let i = 0; i < designs.length; i++) {
      const card = await buildCard(designs[i], i);
      grid.appendChild(card);
      cards.push(card);
    }
    setupLazyLoading(cards, designs);
  } catch (err) {
    console.error('Failed to load designs:', err);
    grid.innerHTML = `
      <div class="gallery-error">
        <p>Could not load designs for this category.</p>
        <p style="font-size:0.75rem;opacity:0.6;margin-top:0.5rem">${err.message}</p>
      </div>
    `;
  }
}

window.selectDesign = selectDesign;
document.addEventListener('DOMContentLoaded', init);