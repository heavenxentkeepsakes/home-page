// gallery.js — Design selection page

async function loadDesigns() {
  const res = await fetch('./designs.json');
  if (!res.ok) throw new Error('Could not load designs.json');
  return res.json();
}

// Font cache to avoid duplicate loading
const loadedFonts = new Set();
const loadingFonts = new Map(); // Track in-progress font loads

async function loadFontFamily(fontFamily) {
  if (!fontFamily) return;
  
  // Extract the main font name (first in the list)
  const mainFont = fontFamily.split(',')[0].trim().replace(/["']/g, '');
  if (loadedFonts.has(mainFont)) return;
  if (loadingFonts.has(mainFont)) return loadingFonts.get(mainFont);
  
  const loadPromise = (async () => {
    try {
      // Check if font is already loaded via Google Fonts
      if (document.fonts) {
        // Try to check if font is available
        const fontCheck = await document.fonts.load(`16px "${mainFont}"`).catch(() => null);
        if (fontCheck && fontCheck.length > 0) {
          loadedFonts.add(mainFont);
          return;
        }
      }
      
      // If we have the font URL from the design, load it
      // But we don't store font URLs per font family in the current structure
      // We'll need to map font families to their Google Fonts URLs
      const fontUrl = getFontUrlForFamily(mainFont);
      if (fontUrl) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = fontUrl;
        document.head.appendChild(link);
        
        await new Promise((resolve, reject) => {
          link.onload = resolve;
          link.onerror = reject;
        });
      }
      
      if (document.fonts) {
        await document.fonts.load(`16px "${mainFont}"`);
      }
      
      loadedFonts.add(mainFont);
    } catch (err) {
      console.warn(`Failed to load font: ${mainFont}`, err);
    }
  })();
  
  loadingFonts.set(mainFont, loadPromise);
  await loadPromise;
  loadingFonts.delete(mainFont);
}

// Map common font families to their Google Fonts URLs
function getFontUrlForFamily(fontFamily) {
  const fontMap = {
    'Bebas Neue': 'https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap',
    'Barlow Condensed': 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&display=swap',
    'Gilda Display': 'https://fonts.googleapis.com/css2?family=Gilda+Display&display=swap',
    'Cinzel': 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;800;900&display=swap',
    'Lora': 'https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&display=swap',
    'Literata': 'https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400&display=swap',
    'Pinyon Script': 'https://fonts.googleapis.com/css2?family=Pinyon+Script&display=swap',
    'Great Vibes': 'https://fonts.googleapis.com/css2?family=Great+Vibes&display=swap',
    'Inria Serif': 'https://fonts.googleapis.com/css2?family=Inria+Serif:ital,wght@0,400;0,700;1,400&display=swap',
    'Petit Formal Script': 'https://fonts.googleapis.com/css2?family=Petit+Formal+Script&display=swap',
    'Source Serif Pro': 'https://fonts.googleapis.com/css2?family=Source+Serif+Pro:ital,wght@0,400;0,600;0,700;1,400&display=swap',
    'Tangerine': 'https://fonts.googleapis.com/css2?family=Tangerine:wght@400;700&display=swap',
    'Roboto Condensed': 'https://fonts.googleapis.com/css2?family=Roboto+Condensed:ital,wght@0,300;0,400;0,700;1,300;1,400;1,700&display=swap',
    'Parisienne': 'https://fonts.googleapis.com/css2?family=Parisienne&display=swap',
    'Montserrat': 'https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&display=swap',
    'Alegreya': 'https://fonts.googleapis.com/css2?family=Alegreya:ital,wght@0,400;0,500;0,600;1,400&display=swap',
    'Open Sans': 'https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&display=swap',
    'Srisakdi': 'https://fonts.googleapis.com/css2?family=Srisakdi:wght@400;700&display=swap',
    'Cormorant Garamond': 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap',
    'Glass Antiqua': 'https://fonts.googleapis.com/css2?family=Glass+Antiqua&display=swap',
    'Noto Sans JP': 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@100;300;400;500;700&display=swap',
    'Pacifico': 'https://fonts.googleapis.com/css2?family=Pacifico&display=swap',
    'Pompiere': 'https://fonts.googleapis.com/css2?family=Pompiere&display=swap'
  };
  
  return fontMap[fontFamily] || null;
}

async function loadFontsForDesign(design) {
  const fontFamilies = new Set();
  const fields = design.fields;
  
  if (fields.couple) fontFamilies.add(fields.couple.fontFamily.split(',')[0].trim().replace(/["']/g, ''));
  if (fields.date) fontFamilies.add(fields.date.fontFamily.split(',')[0].trim().replace(/["']/g, ''));
  if (fields.tagline) fontFamilies.add(fields.tagline.fontFamily.split(',')[0].trim().replace(/["']/g, ''));
  if (fields.photo && fields.photo.ampFontFamily) fontFamilies.add(fields.photo.ampFontFamily.split(',')[0].trim().replace(/["']/g, ''));
  
  // Load fonts sequentially to avoid overwhelming the browser
  for (const family of fontFamilies) {
    await loadFontFamily(family);
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
    if (design.fields.photo && design.fields.photo.enabled) {
      try {
        const res = await fetch('./couple.jpg');
        const blob = await res.blob();
        photoDataURL = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        console.warn('Could not load default couple.jpg for thumbnail:', e);
      }
    }

    const defaultTagline = design.fields.tagline?.defaultValue || 'Forever starts today';
    const sampleValues = { name1: 'Ethan', name2: 'Maria', date: '', tagline: defaultTagline };
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

  // Thumbnail area - initially not loaded
  const thumb = document.createElement('div');
  thumb.className = 'gallery-thumb';
  const isVisible = index < 4; // Only load first 4 immediately
  thumb.appendChild(await buildThumbnailTag(design, isVisible));

  // Card body
  const photoEnabled = design.fields.photo && design.fields.photo.enabled;
  const fontName = design.fields.couple.fontFamily.split(',')[0];

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
  window.location.href = 'editor.html';
}

async function init() {
  const grid = document.getElementById('galleryGrid');
  try {
    const designs = await loadDesigns();
    
    grid.innerHTML = '';
    const cards = [];
    
    // Build all cards but only render visible ones
    for (let i = 0; i < designs.length; i++) {
      const card = await buildCard(designs[i], i);
      grid.appendChild(card);
      cards.push(card);
    }
    
    // Setup lazy loading for cards not initially visible
    setupLazyLoading(cards, designs);
    
  } catch (err) {
    console.error('Failed to load designs:', err);
    grid.innerHTML = `
      <div class="gallery-error">
        <p>Could not load designs. Make sure <code>designs.json</code> is in the same folder.</p>
        <p style="font-size:0.75rem;opacity:0.6;margin-top:0.5rem">${err.message}</p>
      </div>
    `;
  }
}

window.selectDesign = selectDesign;
document.addEventListener('DOMContentLoaded', init);