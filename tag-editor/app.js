
// Global state
let _currentDesign = null;
let _photoDataURL = null;
let _tagRoot = null;
let _updateTagTimer = null;
let _fontData = [];
let _isDropdownOpen = false;
let _cropper = null;

const MAX_CROP_SIZE = 1600;
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];
let _dateState = { month: null, day: null, year: null };

// Parse URL parameters
function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    productId: params.get('product') || params.get('id'),
    category: params.get('category')
  };
}

// Helper to detect category from design ID prefix
function detectCategoryFromDesignId(designId) {
  if (!designId) return null;

  // Define prefixes for each category based on your naming convention
  const categoryMap = {
    'wt': 'wedding-tag',     // Wedding tags start with wt (e.g., wt001, wt002)
    'bp': 'baptism-tag',     // Baptism tags start with bp (e.g., bp001, bp002)
    'ct': 'christmas-tag',   // Christmas tags start with ct (e.g., ct001, ct002)
  };

  for (const [prefix, category] of Object.entries(categoryMap)) {
    if (designId.toLowerCase().startsWith(prefix)) {
      console.log(`Detected category ${category} from design ID prefix ${prefix}`);
      return category;
    }
  }

  console.warn(`Could not detect category from design ID: ${designId}, using default`);
  return 'wedding-tag'; // Default fallback
}

// =====================================================
// FONT MANAGEMENT
// =====================================================

async function collectAvailableFonts() {
  try {
    const selectedCategory = sessionStorage.getItem('selectedCategory') || 'wedding-tag';
    const designs = await fetch(`/tag-editor/products/${selectedCategory}.json`).then(r => r.json());
    const fontMap = new Map();

    designs.forEach(design => {
      if (design.fields?.name?.fontFamily) {
        const fullFamily = design.fields.name.fontFamily;
        const mainFont = fullFamily.split(',')[0].trim().replace(/["']/g, '');

        if (!fontMap.has(mainFont)) {
          fontMap.set(mainFont, {
            family: mainFont,
            fullFamily: fullFamily,
            weight: design.fields.name.fontWeight || '400',
            style: design.fields.name.fontStyle || 'normal'
          });
        }
      }
    });

    _fontData = Array.from(fontMap.values()).sort((a, b) => a.family.localeCompare(b.family));
    return _fontData;
  } catch (err) {
    console.error('Failed to collect fonts:', err);
    return [];
  }
}

async function preloadAllFonts() {
  const loadPromises = _fontData.map(font => TagRenderer.loadFontFamily(font.family));
  await Promise.all(loadPromises);
}

async function loadFontsForDesign(design) {
  if (!design?.fields) return;

  const fontFamilies = new Set();
  const fields = design.fields;

  if (fields.name) fontFamilies.add(fields.name.fontFamily);
  if (fields.date && fields.date.enabled !== false) fontFamilies.add(fields.date.fontFamily);
  if (fields.tagline && fields.tagline.enabled !== false) fontFamilies.add(fields.tagline.fontFamily);
  if (fields.photo?.ampFontFamily) fontFamilies.add(fields.photo.ampFontFamily);

  const loadPromises = Array.from(fontFamilies).map(family => TagRenderer.loadFontFamily(family));
  await Promise.all(loadPromises);
  await new Promise(resolve => setTimeout(resolve, 100));
}

// =====================================================
// FONT DROPDOWN
// =====================================================

function populateFontDropdown() {
  const optionsContainer = document.getElementById('fontSelectOptions');
  if (!optionsContainer) return;

  optionsContainer.innerHTML = '';
  _fontData.forEach(font => {
    const option = document.createElement('div');
    option.className = 'custom-select-option';
    option.setAttribute('data-font', font.family);
    option.style.fontFamily = `"${font.family}", sans-serif`;
    option.style.fontWeight = font.weight;
    option.style.fontStyle = font.style;
    option.style.fontSize = '0.9rem';
    option.style.padding = '10px 12px';
    option.style.cursor = 'pointer';
    option.style.borderBottom = '1px solid #f0e8dc';
    option.textContent = font.family;

    option.addEventListener('mouseenter', () => option.style.background = '#faf6f1');
    option.addEventListener('mouseleave', () => option.style.background = '');
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      selectFont(font.family);
    });

    optionsContainer.appendChild(option);
  });

  if (_currentDesign?.fields?.name) {
    const currentFont = _currentDesign.fields.name.fontFamily.split(',')[0].trim().replace(/["']/g, '');
    updateSelectedFontDisplay(currentFont);
  }
}

function updateSelectedFontDisplay(fontFamily) {
  const selectedSpan = document.getElementById('selectedFontDisplay');
  if (!selectedSpan) return;

  const font = _fontData.find(f => f.family === fontFamily);
  if (font) {
    selectedSpan.textContent = font.family;
    selectedSpan.style.fontFamily = `"${font.family}", sans-serif`;
    selectedSpan.style.fontWeight = font.weight;
    selectedSpan.style.fontStyle = font.style;
  } else {
    selectedSpan.textContent = fontFamily || 'Select a font...';
    selectedSpan.style.fontFamily = 'Jost, sans-serif';
  }
}

function toggleDropdown() {
  const optionsContainer = document.getElementById('fontSelectOptions');
  const trigger = document.getElementById('fontSelectTrigger');
  if (!optionsContainer || !trigger) return;

  _isDropdownOpen = !_isDropdownOpen;
  optionsContainer.classList.toggle('show', _isDropdownOpen);
  trigger.classList.toggle('open', _isDropdownOpen);

  if (_isDropdownOpen) {
    setTimeout(() => document.addEventListener('click', closeDropdownOnClickOutside), 0);
  } else {
    document.removeEventListener('click', closeDropdownOnClickOutside);
  }
}

function closeDropdownOnClickOutside(event) {
  const wrapper = document.getElementById('fontSelectWrapper');
  if (wrapper && !wrapper.contains(event.target)) {
    document.getElementById('fontSelectOptions')?.classList.remove('show');
    document.getElementById('fontSelectTrigger')?.classList.remove('open');
    _isDropdownOpen = false;
    document.removeEventListener('click', closeDropdownOnClickOutside);
  }
}

async function selectFont(fontFamily) {
  if (!_currentDesign || !_tagRoot) return;

  document.getElementById('fontSelectOptions')?.classList.remove('show');
  document.getElementById('fontSelectTrigger')?.classList.remove('open');
  _isDropdownOpen = false;
  updateSelectedFontDisplay(fontFamily);

  try {
    await TagRenderer.loadFontFamily(fontFamily);

    const originalFontFamily = _currentDesign.fields.name.fontFamily;
    const fallbackFonts = originalFontFamily.split(',').slice(1).join(',').trim();
    _currentDesign.fields.name.fontFamily = `"${fontFamily}", ${fallbackFonts || 'sans-serif'}`;

    if (_currentDesign.fields.name.ampFontFamily) {
      const originalAmpFont = _currentDesign.fields.name.ampFontFamily;
      const ampFallbackFonts = originalAmpFont.split(',').slice(1).join(',').trim();
      _currentDesign.fields.name.ampFontFamily = `"${fontFamily}", ${ampFallbackFonts || 'sans-serif'}`;
    }

    await doUpdateTag();
  } catch (err) {
    console.error('Failed to change font:', err);
  }
}

function initDropdown() {
  const trigger = document.getElementById('fontSelectTrigger');
  if (trigger) {
    const newTrigger = trigger.cloneNode(true);
    trigger.parentNode.replaceChild(newTrigger, trigger);
    newTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown();
    });
  }
}

// =====================================================
// DATE PICKER
// =====================================================

function makeDateOption(value, label, selectFn) {
  const opt = document.createElement('div');
  opt.className = 'custom-select-option';
  opt.textContent = label;
  opt.addEventListener('mouseenter', () => opt.style.background = '#faf6f1');
  opt.addEventListener('mouseleave', () => opt.style.background = '');
  opt.addEventListener('click', e => { e.stopPropagation(); selectFn(value, label); });
  return opt;
}

function syncHiddenDate() {
  const { month, day, year } = _dateState;
  const field = document.getElementById('wdate');
  if (field) {
    if (month && day && year) {
      field.value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    } else {
      field.value = '';
    }
  }
  updateTag();
}

function openDateDropdown(wrapperId, triggerId, optionsId) {
  ['month', 'day', 'year'].forEach(part => {
    document.getElementById(`${part}SelectOptions`)?.classList.remove('show');
    document.getElementById(`${part}SelectTrigger`)?.classList.remove('open');
  });

  const opts = document.getElementById(optionsId);
  const trig = document.getElementById(triggerId);
  if (!opts || !trig) return;

  opts.classList.add('show');
  trig.classList.add('open');

  setTimeout(() => {
    document.addEventListener('click', function closeDate(e) {
      const wrapper = document.getElementById(wrapperId);
      if (wrapper && !wrapper.contains(e.target)) {
        opts.classList.remove('show');
        trig.classList.remove('open');
        document.removeEventListener('click', closeDate);
      }
    });
  }, 0);
}

function initDatePicker() {
  const monthOpts = document.getElementById('monthSelectOptions');
  const dayOpts = document.getElementById('daySelectOptions');
  const yearOpts = document.getElementById('yearSelectOptions');
  if (!monthOpts || !dayOpts || !yearOpts) return;

  MONTHS.forEach((name, i) => {
    monthOpts.appendChild(makeDateOption(i + 1, name, (val, label) => {
      _dateState.month = val;
      const el = document.getElementById('selectedMonthDisplay');
      if (el) { el.textContent = label; el.style.color = 'var(--ink)'; }
      document.getElementById('monthSelectOptions').classList.remove('show');
      document.getElementById('monthSelectTrigger').classList.remove('open');
      syncHiddenDate();
    }));
  });

  for (let d = 1; d <= 31; d++) {
    dayOpts.appendChild(makeDateOption(d, String(d), (val) => {
      _dateState.day = val;
      const el = document.getElementById('selectedDayDisplay');
      if (el) { el.textContent = val; el.style.color = 'var(--ink)'; }
      document.getElementById('daySelectOptions').classList.remove('show');
      document.getElementById('daySelectTrigger').classList.remove('open');
      syncHiddenDate();
    }));
  }

  const thisYear = new Date().getFullYear();
  const startYear = thisYear - 2;  // 2 years before current
  const endYear = thisYear + 10;   // 10 years after current
  const years = [];

  // Populate in ascending order (oldest to newest)
  for (let y = startYear; y <= endYear; y++) {
    years.push(y);
  }

  years.forEach(y => {
    yearOpts.appendChild(makeDateOption(y, String(y), (val) => {
      _dateState.year = val;
      const el = document.getElementById('selectedYearDisplay');
      if (el) { el.textContent = val; el.style.color = 'var(--ink)'; }
      document.getElementById('yearSelectOptions').classList.remove('show');
      document.getElementById('yearSelectTrigger').classList.remove('open');
      syncHiddenDate();
    }));
  });

  document.getElementById('monthSelectTrigger')?.addEventListener('click', e => {
    e.stopPropagation();
    openDateDropdown('monthSelectWrapper', 'monthSelectTrigger', 'monthSelectOptions');
  });
  document.getElementById('daySelectTrigger')?.addEventListener('click', e => {
    e.stopPropagation();
    openDateDropdown('daySelectWrapper', 'daySelectTrigger', 'daySelectOptions');
  });
  document.getElementById('yearSelectTrigger')?.addEventListener('click', e => {
    e.stopPropagation();
    openDateDropdown('yearSelectWrapper', 'yearSelectTrigger', 'yearSelectOptions');
  });
}

// =====================================================
// FORM VALUES & TAG UPDATES
// =====================================================

function getValues() {
  const name1El = document.getElementById('name1');
  const name2El = document.getElementById('name2');
  return {
    name1: name1El?.value.trim() || name1El?.placeholder || '',
    name2: name2El?.value.trim() || name2El?.placeholder || '',
    date: document.getElementById('wdate')?.value || '',
    tagline: document.getElementById('tagline')?.value || '',
  };
}

function updateTag() {
  const name1Input = document.getElementById('name1');
  const name2Input = document.getElementById('name2');
  const amp = document.querySelector('.ampersand');
  const nameRow = name1Input?.parentElement;

  if (name2Input && amp && nameRow) {
    const name2Val = name2Input.value.trim() || name2Input.placeholder.trim();
    if (name2Val === '') {
      nameRow.style.gridTemplateColumns = '1fr';
      amp.style.display = 'none';
      name2Input.style.display = 'none';
    } else {
      nameRow.style.gridTemplateColumns = '1fr auto 1fr';
      amp.style.display = '';
      name2Input.style.display = 'block';
    }
  }

  clearTimeout(_updateTagTimer);
  _updateTagTimer = setTimeout(() => doUpdateTag(), 80);
}

async function doUpdateTag() {
  if (!_currentDesign || !_tagRoot) return;
  await TagRenderer.updateTagElement(_tagRoot, _currentDesign, getValues(), _photoDataURL);

  _tagRoot.classList.remove('updating');
  requestAnimationFrame(() => requestAnimationFrame(() => _tagRoot.classList.add('updating')));
}

// =====================================================
// PHOTO UPLOAD & CROP
// =====================================================

async function handlePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const cropModal = document.getElementById('cropModal');
  const cropImage = document.getElementById('cropImage');
  const cropLoading = document.getElementById('cropLoading');

  cropImage.style.display = 'none';
  cropLoading.style.display = 'flex';
  cropModal.classList.add('open');

  try {
    let sourceFile = file;
    const isHeic = file.type === 'image/heic' || file.type === 'image/heif' ||
      file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif');

    if (isHeic) {
      if (typeof HeicTo === 'undefined') throw new Error('HEIC converter not loaded');
      const jpegBlob = await HeicTo({ blob: file, type: 'image/jpeg', quality: 0.92 });
      sourceFile = new File([jpegBlob], file.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' });
    }

    const bitmap = await createImageBitmap(sourceFile);
    const scale = Math.min(1, MAX_CROP_SIZE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    cropImage.src = canvas.toDataURL('image/jpeg', 0.92);
    cropImage.onload = () => {
      cropLoading.style.display = 'none';
      cropImage.style.display = 'block';

      if (_cropper) { _cropper.destroy(); _cropper = null; }

      _cropper = new Cropper(cropImage, {
        aspectRatio: _currentDesign.fields.photo.width / _currentDesign.fields.photo.height,
        viewMode: 2,
        movable: true,
        zoomable: true,
        rotatable: false,
        minContainerHeight: 200,
      });
    };
  } catch (err) {
    console.error('Photo load error:', err);
    cropLoading.innerHTML = `<div style="text-align:center;color:#c4956a;padding:16px;"><p>Could not load this photo.</p></div>`;
  }
}

function confirmCrop() {
  if (!_cropper) return;

  const canvas = _cropper.getCroppedCanvas({
    width: _currentDesign.fields.photo.width * 2,
    height: _currentDesign.fields.photo.height * 2,
  });

  _photoDataURL = canvas.toDataURL('image/jpeg', 0.92);

  document.getElementById('photoRemoveBtn').style.display = 'block';
  document.getElementById('photoUploadLabel').style.display = 'none';

  cancelCrop();
  doUpdateTag();
}

function cancelCrop() {
  if (_cropper) { _cropper.destroy(); _cropper = null; }
  document.getElementById('cropModal').classList.remove('open');
  document.getElementById('photoInput').value = '';
}

function removePhoto() {
  _photoDataURL = null;

  document.getElementById('photoInput').value = '';
  document.getElementById('photoRemoveBtn').style.display = 'none';
  document.getElementById('photoUploadLabel').style.display = 'flex';

  // Change this part - load blank.jpg directly instead of using _currentDesign
  fetch('blank.jpg')  // Changed from _currentDesign.fields.photo?.defaultImage
    .then(res => res.blob())
    .then(blob => {
      const reader = new FileReader();
      reader.onload = (e) => {
        _photoDataURL = e.target.result;
        doUpdateTag();
      };
      reader.readAsDataURL(blob);
    })
    .catch(e => {
      console.warn('Could not load blank.jpg, using no photo:', e);
      doUpdateTag();  // Fallback to no photo if blank.jpg doesn't exist
    });
}

// =====================================================
// PDF GENERATION & CHECKOUT
// =====================================================

let _cachedPDFBlob = null;

async function buildPDFBlob(tagCanvas) {
  const A4_W_MM = 210, A4_H_MM = 297;
  const COLS = 4, ROWS = 3, MARGIN_MM = 8, GAP_MM = 4;
  const tagW_MM = (A4_W_MM - MARGIN_MM * 2 - GAP_MM * (COLS - 1)) / COLS;
  const tagH_MM = (A4_H_MM - MARGIN_MM * 2 - GAP_MM * (ROWS - 1)) / ROWS;

  const imgData = tagCanvas.toDataURL('image/png');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, A4_W_MM, A4_H_MM, 'F');

  const ALIAS = 'tag';
  pdf.addImage(imgData, 'PNG', MARGIN_MM, MARGIN_MM, tagW_MM, tagH_MM, ALIAS, 'NONE');
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (row === 0 && col === 0) continue;
      pdf.addImage(imgData, 'PNG', MARGIN_MM + col * (tagW_MM + GAP_MM), MARGIN_MM + row * (tagH_MM + GAP_MM), tagW_MM, tagH_MM, ALIAS, 'NONE');
    }
  }

  pdf.setFontSize(5);
  pdf.setTextColor(180, 160, 140);
  pdf.text(`HeavenXent Keepsakes · ${_currentDesign?.name || 'Custom'} · 12 Custom Wedding Tags · Print at 100% on A4`, A4_W_MM / 2, A4_H_MM - 2.5, { align: 'center' });

  return pdf.output('blob');
}

async function openPreviewModal() {
  const modal = document.getElementById('previewModal');
  const grid = document.getElementById('a4Grid');
  const loading = document.getElementById('a4Loading');
  const nameEl = document.getElementById('modalDesignName');

  grid.style.display = 'none';
  grid.innerHTML = '';
  loading.style.display = 'flex';
  _cachedPDFBlob = null;

  if (nameEl && _currentDesign) nameEl.textContent = _currentDesign.name || 'Custom';

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  try {
    const tagCanvas = await TagRenderer.buildTagCanvas(_currentDesign, getValues(), _photoDataURL);
    const imgSrc = tagCanvas.toDataURL('image/png');

    for (let i = 0; i < 12; i++) {
      const cell = document.createElement('div');
      cell.className = 'a4-tag-cell';
      const img = document.createElement('img');
      img.src = imgSrc;
      img.alt = 'Tag preview';
      img.oncontextmenu = () => false;
      img.ondragstart = () => false;
      img.style.pointerEvents = 'none';
      cell.appendChild(img);
      grid.appendChild(cell);
    }

    loading.style.display = 'none';
    grid.style.display = 'grid';
    _cachedPDFBlob = await buildPDFBlob(tagCanvas);
  } catch (err) {
    console.error('Modal render failed:', err);
    loading.textContent = 'Could not render preview. Please try again.';
  }
}

function closePreviewModal(force) {
  if (force !== true && force && force.target !== document.getElementById('previewModal')) return;
  document.getElementById('previewModal').classList.remove('open');
  document.body.style.overflow = '';
}

async function handleCheckout() {
  const nameInput = document.getElementById('checkoutName');
  const emailInput = document.getElementById('checkoutEmail');
  const fieldError = document.getElementById('checkoutError');

  const customerName = nameInput.value.trim();
  const customerEmail = emailInput.value.trim();

  nameInput.classList.remove('input-error');
  emailInput.classList.remove('input-error');
  fieldError.classList.remove('visible');

  if (!customerName || !customerEmail) {
    if (!customerName) nameInput.classList.add('input-error');
    if (!customerEmail) emailInput.classList.add('input-error');
    fieldError.classList.add('visible');
    return;
  }

  const btn = document.getElementById('btnCheckout');
  btn.disabled = true;
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>Redirecting to checkout…`;

  try {
    let blob = _cachedPDFBlob;
    if (!blob) {
      const tagCanvas = await TagRenderer.buildTagCanvas(_currentDesign, getValues(), _photoDataURL);
      blob = await buildPDFBlob(tagCanvas);
    }

    const arrayBuffer = await blob.arrayBuffer();
    const base64PDF = btoa(new Uint8Array(arrayBuffer).reduce((d, b) => d + String.fromCharCode(b), ''));

    const res = await fetch('https://api.heavenxentph.com/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: customerName,
        email: customerEmail,
        type: 'PDF',
        pdf: base64PDF
      })
    });

    const data = await res.json();
    if (data.checkout_url) {
      window.location.href = data.checkout_url;
    } else {
      throw new Error('No checkout URL returned');
    }
  } catch (err) {
    console.error(err);
    alert('Something went wrong. Please try again.');
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Buy & Download PDF — ₱199`;
  }
}

// =====================================================
// INITIALIZATION
// =====================================================

window.addEventListener('DOMContentLoaded', async () => {
  console.log("🚀 App initializing...");

  try {
    // PRIORITY 1: Check URL parameters first
    const urlParams = getUrlParams();
    let designId = urlParams.productId;
    let selectedCategory = urlParams.category;

    // PRIORITY 2: Fall back to sessionStorage
    if (!designId) {
      designId = sessionStorage.getItem('selectedDesignId');
      selectedCategory = sessionStorage.getItem('selectedCategory');
      console.log('Using sessionStorage:', designId);
    } else {
      console.log('Using URL parameter:', designId, 'category:', selectedCategory);
    }

    // If still no design ID, redirect to gallery
    if (!designId) {
      console.error('No design selected. Redirecting to gallery...');
      window.location.href = '/tag-editor/index.html';
      return;
    }

    // If we don't have a category from URL or sessionStorage, try to detect it from the design ID
    if (!selectedCategory) {
      selectedCategory = detectCategoryFromDesignId(designId);
      console.log(`No category provided, detected: ${selectedCategory}`);
    }

    // Try to load the design
    let designs = null;
    let foundCategory = null;

    // First try the category we have (from URL, sessionStorage, or detection)
    if (selectedCategory) {
      try {
        console.log(`Trying to load from category: ${selectedCategory}`);
        const res = await fetch(`/tag-editor/products/${selectedCategory}.json`);
        if (res.ok) {
          designs = await res.json();
          const found = designs.find(d => d.id === designId);
          if (found) {
            foundCategory = selectedCategory;
            console.log(`✓ Found design in category: ${selectedCategory}`);
          } else {
            console.log(`Design not found in ${selectedCategory}, searching all categories...`);
            designs = null; // Reset to search all
          }
        } else {
          console.log(`Category ${selectedCategory} not found, searching all categories...`);
          designs = null;
        }
      } catch (e) {
        console.warn(`Could not load category ${selectedCategory}:`, e);
        designs = null;
      }
    }

    // If design not found in specified category, search all categories
    if (!designs || !designs.find(d => d.id === designId)) {
      const categories = ['wedding-tag', 'baptism-tag', 'christmas-tag'];

      for (const cat of categories) {
        // Skip if we already tried this category and it didn't work
        if (cat === selectedCategory) continue;

        try {
          console.log(`Searching in category: ${cat}`);
          const res = await fetch(`/tag-editor/products/${cat}.json`);
          if (res.ok) {
            const catDesigns = await res.json();
            const found = catDesigns.find(d => d.id === designId);
            if (found) {
              designs = catDesigns;
              foundCategory = cat;
              console.log(`✓ Found design in category: ${cat}`);
              break;
            }
          }
        } catch (e) {
          console.warn(`Could not check category ${cat}:`, e);
        }
      }
    }

    // If still no design found, throw error
    if (!designs || !designs.find(d => d.id === designId)) {
      throw new Error(`Design ${designId} not found in any category`);
    }

    // Get the actual design object
    _currentDesign = designs.find(d => d.id === designId);
    if (!_currentDesign) {
      throw new Error(`Design ${designId} not found`);
    }

    console.log('✅ Design loaded:', _currentDesign.name);
    console.log('📁 Category:', foundCategory);

    // Update UI labels
    const nameStepLabel = document.querySelector('#nameStepLabel');
    const dateStepLabel = document.querySelector('#dateStepLabel');
    if (nameStepLabel) nameStepLabel.textContent = _currentDesign.fields.name.label || 'Names';
    if (dateStepLabel) dateStepLabel.textContent = _currentDesign.fields.date.label || 'Date';

    document.getElementById('name1').placeholder = _currentDesign.fields.name.preset?.name1 || '';
    document.getElementById('name2').placeholder = _currentDesign.fields.name.preset?.name2 || '';

    // Update back links with the found category
    const backLink1 = document.querySelector('.back-to-designs');
    const backLink2 = document.querySelector('.design-badge-change');
    const backUrl = foundCategory ? `index.html#/${foundCategory}` : 'index.html';
    if (backLink1) backLink1.href = backUrl;
    if (backLink2) backLink2.href = backUrl;

    // Also store the category in sessionStorage for consistency
    if (foundCategory) {
      sessionStorage.setItem('selectedCategory', foundCategory);
    }

    document.getElementById('designBadgeName').textContent = _currentDesign.name;
    document.getElementById('previewDesignName').textContent = _currentDesign.name;

    const photoStep = document.getElementById('photoStep');
    if (photoStep) photoStep.style.display = _currentDesign.fields.photo?.enabled ? 'flex' : 'none';

    const dateStep = document.getElementById('dateStep');
    if (dateStep) dateStep.style.display = _currentDesign.fields.date?.enabled !== false ? 'flex' : 'none';

    const taglineInput = document.getElementById('tagline');
    if (taglineInput && _currentDesign.fields.tagline?.defaultValue) {
      taglineInput.placeholder = _currentDesign.fields.tagline.defaultValue;
      if (!taglineInput.value) taglineInput.value = _currentDesign.fields.tagline.defaultValue;
    }

    // Load fonts
    await collectAvailableFonts();
    await preloadAllFonts();
    await loadFontsForDesign(_currentDesign);

    // Load default photo
    if (_currentDesign.fields.photo?.enabled && _currentDesign.fields.photo?.defaultImage) {
      try {
        const photoRes = await fetch(_currentDesign.fields.photo.defaultImage);
        const blob = await photoRes.blob();
        _photoDataURL = await new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target.result);
          reader.readAsDataURL(blob);
        });
        document.getElementById('photoRemoveBtn').style.display = 'block';
        document.getElementById('photoUploadLabel').style.display = 'none';
      } catch (e) {
        console.warn('Could not load default photo:', e);
      }
    }

    // Initialize UI
    populateFontDropdown();
    initDropdown();
    updateTag();

    // Only initialize date picker if date field is enabled
    if (_currentDesign.fields.date?.enabled !== false) {
      initDatePicker();
    }

    // Render desktop preview
    const wrapper = document.getElementById('tagWrapper');
    if (wrapper) {
      wrapper.style.width = _currentDesign.tagDimensions.width + 'px';
      wrapper.style.height = _currentDesign.tagDimensions.height + 'px';
      _tagRoot = await TagRenderer.buildTagElement(_currentDesign, getValues(), _photoDataURL);
      _tagRoot.id = 'theTag';
      wrapper.innerHTML = '';
      wrapper.appendChild(_tagRoot);
    }

    console.log('✅ App ready!');
  } catch (err) {
    console.error('❌ Init error:', err);
    alert('Error: ' + err.message);
  }
});

// Mobile preview zoom functionality
const previewPanel = document.querySelector('.preview-panel');
const tagWrapperMobile = document.getElementById('tagWrapper');

// Open zoom
tagWrapperMobile.addEventListener('click', function (e) {
  if (window.innerWidth <= 780) {
    e.stopPropagation();
    previewPanel.classList.add('zoomed');
    document.body.classList.add('zoom-active');
  }
});

// Close zoom function
function closeZoom() {
  if (window.innerWidth <= 780 && previewPanel.classList.contains('zoomed')) {
    previewPanel.classList.remove('zoomed');
    document.body.classList.remove('zoom-active');
  }
}

// Close when clicking ANYWHERE on the preview panel (including background)
previewPanel.addEventListener('click', function (e) {
  // Don't close if clicking on the tag wrapper or its children
  if (tagWrapperMobile && tagWrapperMobile.contains(e.target)) {
    e.stopPropagation(); // Stop the click from bubbling
    return; // Don't close
  }
  // Close for any other click (background, padding areas, etc.)
  closeZoom();
});

// Also close on escape key
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    closeZoom();
  }
});

const zoomOverlay = document.getElementById('zoomOverlay');
if (zoomOverlay) {
  zoomOverlay.addEventListener('click', function() {
    closeZoom();
  });
}

// =====================================================
// EXPOSE TO WINDOW
// =====================================================

window.updateTag = updateTag;
window.handlePhotoUpload = handlePhotoUpload;
window.confirmCrop = confirmCrop;
window.cancelCrop = cancelCrop;
window.removePhoto = removePhoto;
window.handleBuyPDF = openPreviewModal;
window.closePreviewModal = closePreviewModal;
window.handleCheckout = handleCheckout;

