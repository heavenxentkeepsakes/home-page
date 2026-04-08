// app.js — Editor page logic (complete fixed version)

let _currentDesign = null;
let _photoDataURL = null;
let _tagRoot = null;   // the live tag DOM element
let _updateTagTimer = null;
let _fontData = []; // Store font data with display names and families
let _isDropdownOpen = false;

// ─── Font loading helper with actual font file loading ────────────────────────
const loadedFonts = new Set();
const loadingFonts = new Map();

function getFontUrlForFamily(fontFamily) {
  // Map font families to their Google Fonts URLs
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

  // Try to match the font family (might include multiple fonts)
  for (const [key, url] of Object.entries(fontMap)) {
    if (fontFamily.includes(key)) {
      return url;
    }
  }
  return null;
}

async function loadFontFamily(fontFamily) {
  if (!fontFamily) return;

  // Extract the main font name
  const mainFont = fontFamily.split(',')[0].trim().replace(/["']/g, '');

  // Check if already loaded
  if (loadedFonts.has(mainFont)) return;
  if (loadingFonts.has(mainFont)) return loadingFonts.get(mainFont);

  const loadPromise = (async () => {
    try {
      // Get the font URL
      const fontUrl = getFontUrlForFamily(mainFont);

      if (fontUrl) {
        // Create a unique ID for this font link
        const fontId = `font-${mainFont.replace(/\s+/g, '-').toLowerCase()}`;
        let link = document.getElementById(fontId);

        if (!link) {
          link = document.createElement('link');
          link.id = fontId;
          link.rel = 'stylesheet';
          link.href = fontUrl;
          document.head.appendChild(link);

          // Wait for the stylesheet to load
          await new Promise((resolve, reject) => {
            link.onload = resolve;
            link.onerror = () => reject(new Error(`Failed to load font: ${mainFont}`));
          });
        }

        // Wait for the font to be ready
        if (document.fonts) {
          await document.fonts.ready;
          // Force load the specific font with different sizes to ensure it's available
          await Promise.all([
            document.fonts.load(`16px "${mainFont}"`),
            document.fonts.load(`24px "${mainFont}"`),
            document.fonts.load(`32px "${mainFont}"`)
          ]).catch(() => null);
        }
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

// Function to collect all unique fonts from designs.json with their display info
async function collectAvailableFonts() {
  try {
    const designs = await fetch('./designs.json').then(r => r.json());
    const fontMap = new Map();

    designs.forEach(design => {
      if (design.fields && design.fields.couple && design.fields.couple.fontFamily) {
        // Extract the main font name (first in the list)
        const fullFamily = design.fields.couple.fontFamily;
        const mainFont = fullFamily.split(',')[0].trim().replace(/["']/g, '');

        // Store font data
        if (!fontMap.has(mainFont)) {
          // Get the font weight and style from the design
          const fontWeight = design.fields.couple.fontWeight || '400';
          const fontStyle = design.fields.couple.fontStyle || 'normal';

          fontMap.set(mainFont, {
            family: mainFont,
            fullFamily: fullFamily,
            weight: fontWeight,
            style: fontStyle
          });
        }
      }
    });

    // Convert to array and sort alphabetically
    _fontData = Array.from(fontMap.values()).sort((a, b) => a.family.localeCompare(b.family));
    return _fontData;
  } catch (err) {
    console.error('Failed to collect fonts:', err);
    return [];
  }
}

// Preload all fonts for the dropdown
async function preloadAllFonts() {
  const loadPromises = _fontData.map(font => loadFontFamily(font.family));
  await Promise.all(loadPromises);
}

// Populate the custom dropdown with styled options
function populateFontDropdown() {
  const optionsContainer = document.getElementById('fontSelectOptions');
  if (!optionsContainer) return;

  optionsContainer.innerHTML = '';

  // Create styled options for each font
  _fontData.forEach(font => {
    const option = document.createElement('div');
    option.className = 'custom-select-option';
    option.setAttribute('data-font', font.family);
    option.setAttribute('data-weight', font.weight);
    option.setAttribute('data-style', font.style);

    // Apply the font style to the option
    option.style.fontFamily = `"${font.family}", sans-serif`;
    option.style.fontWeight = font.weight;
    option.style.fontStyle = font.style;
    option.style.fontSize = '0.9rem';
    option.style.padding = '10px 12px';
    option.style.cursor = 'pointer';
    option.style.transition = 'background 0.2s';
    option.style.borderBottom = '1px solid #f0e8dc';

    option.textContent = font.family;

    // Hover effect
    option.addEventListener('mouseenter', () => {
      option.style.background = '#faf6f1';
    });
    option.addEventListener('mouseleave', () => {
      option.style.background = '';
    });

    // Click handler
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      selectFont(font.family);
    });

    optionsContainer.appendChild(option);
  });

  // Set current font display
  if (_currentDesign && _currentDesign.fields.couple) {
    const currentFont = _currentDesign.fields.couple.fontFamily.split(',')[0].trim().replace(/["']/g, '');
    updateSelectedFontDisplay(currentFont);
  }
}

// Update the selected font display
function updateSelectedFontDisplay(fontFamily) {
  const selectedSpan = document.getElementById('selectedFontDisplay');
  if (!selectedSpan) return;

  // Find the font data
  const font = _fontData.find(f => f.family === fontFamily);

  if (font) {
    selectedSpan.textContent = font.family;
    selectedSpan.style.fontFamily = `"${font.family}", sans-serif`;
    selectedSpan.style.fontWeight = font.weight;
    selectedSpan.style.fontStyle = font.style;
  } else if (fontFamily) {
    selectedSpan.textContent = fontFamily;
    selectedSpan.style.fontFamily = `"${fontFamily}", sans-serif`;
    selectedSpan.style.fontWeight = '400';
    selectedSpan.style.fontStyle = 'normal';
  } else {
    selectedSpan.textContent = 'Select a font...';
    selectedSpan.style.fontFamily = 'Jost, sans-serif';
  }
}

// Toggle dropdown
function toggleDropdown() {
  const optionsContainer = document.getElementById('fontSelectOptions');
  const trigger = document.getElementById('fontSelectTrigger');

  if (!optionsContainer || !trigger) return;

  _isDropdownOpen = !_isDropdownOpen;

  if (_isDropdownOpen) {
    optionsContainer.classList.add('show');
    trigger.classList.add('open');

    // Close dropdown when clicking outside
    setTimeout(() => {
      document.addEventListener('click', closeDropdownOnClickOutside);
    }, 0);
  } else {
    optionsContainer.classList.remove('show');
    trigger.classList.remove('open');
    document.removeEventListener('click', closeDropdownOnClickOutside);
  }
}

// Close dropdown when clicking outside
function closeDropdownOnClickOutside(event) {
  const wrapper = document.getElementById('fontSelectWrapper');
  if (wrapper && !wrapper.contains(event.target)) {
    const optionsContainer = document.getElementById('fontSelectOptions');
    const trigger = document.getElementById('fontSelectTrigger');

    if (optionsContainer && trigger) {
      optionsContainer.classList.remove('show');
      trigger.classList.remove('open');
      _isDropdownOpen = false;
    }
    document.removeEventListener('click', closeDropdownOnClickOutside);
  }
}

// Select a font
async function selectFont(fontFamily) {
  if (!_currentDesign || !_tagRoot) return;

  // Close dropdown
  const optionsContainer = document.getElementById('fontSelectOptions');
  const trigger = document.getElementById('fontSelectTrigger');
  if (optionsContainer && trigger) {
    optionsContainer.classList.remove('show');
    trigger.classList.remove('open');
    _isDropdownOpen = false;
  }

  // Update display
  updateSelectedFontDisplay(fontFamily);

  // Show loading indicator on trigger
  const triggerDiv = document.getElementById('fontSelectTrigger');
  const originalBackground = triggerDiv.style.background;
  const originalBorderColor = triggerDiv.style.borderColor;
  triggerDiv.style.background = '#f0e8dc';
  triggerDiv.style.borderColor = '#c4956a';

  try {
    // Load the new font if not already loaded
    await loadFontFamily(fontFamily);

    // Update the design's couple font, preserving the fallback fonts
    const originalFontFamily = _currentDesign.fields.couple.fontFamily;
    const fallbackFonts = originalFontFamily.split(',').slice(1).join(',').trim();
    _currentDesign.fields.couple.fontFamily = `"${fontFamily}", ${fallbackFonts || 'sans-serif'}`;

    // Update the design's amp font if it exists
    if (_currentDesign.fields.couple.ampFontFamily) {
      const originalAmpFont = _currentDesign.fields.couple.ampFontFamily;
      const ampFallbackFonts = originalAmpFont.split(',').slice(1).join(',').trim();
      _currentDesign.fields.couple.ampFontFamily = `"${fontFamily}", ${ampFallbackFonts || 'sans-serif'}`;
    }

    // Re-render the tag
    await _doUpdateTag();

    // Visual feedback - success
    triggerDiv.style.background = '#e8f5e8';
    setTimeout(() => {
      triggerDiv.style.background = originalBackground;
      triggerDiv.style.borderColor = originalBorderColor;
    }, 300);
  } catch (err) {
    console.error('Failed to change font:', err);
    triggerDiv.style.background = '#ffe8e8';
    setTimeout(() => {
      triggerDiv.style.background = originalBackground;
      triggerDiv.style.borderColor = originalBorderColor;
    }, 300);
  }
}

// Initialize dropdown event listeners
function initDropdown() {
  const trigger = document.getElementById('fontSelectTrigger');
  if (trigger) {
    // Remove any existing listeners
    const newTrigger = trigger.cloneNode(true);
    trigger.parentNode.replaceChild(newTrigger, trigger);

    newTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown();
    });
  }
}

async function loadFontsForDesign(design) {
  if (!design || !design.fields) return;

  const fontFamilies = new Set();
  const fields = design.fields;

  if (fields.couple) fontFamilies.add(fields.couple.fontFamily);
  if (fields.date) fontFamilies.add(fields.date.fontFamily);
  if (fields.tagline) fontFamilies.add(fields.tagline.fontFamily);
  if (fields.photo && fields.photo.ampFontFamily) fontFamilies.add(fields.photo.ampFontFamily);

  // Load fonts in parallel
  const loadPromises = Array.from(fontFamilies).map(family => loadFontFamily(family));
  await Promise.all(loadPromises);

  // Extra safety: wait for fonts to be fully applied
  await new Promise(resolve => setTimeout(resolve, 100));
  await new Promise(resolve => requestAnimationFrame(resolve));
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const designId = sessionStorage.getItem('selectedDesignId');
    console.log('Initializing editor with designId:', designId);

    // Load designs
    let designs;
    try {
      designs = await fetch('./designs.json').then(r => r.json());
      console.log('Loaded designs:', designs.length);
    } catch (e) {
      console.error('Could not load designs.json', e);
      alert('Error: Could not load designs. Check console.');
      return;
    }

    _currentDesign = designs.find(d => d.id === designId) || designs[0];
    console.log('Current design:', _currentDesign.name);

    // Collect available fonts from all designs
    await collectAvailableFonts();
    console.log('Fonts collected');

    // Preload all fonts for the dropdown
    await preloadAllFonts();
    console.log('All fonts preloaded');

    // Populate dropdown after fonts are loaded
    populateFontDropdown();
    initDropdown();

    // Show loading state
    const wrapper = document.getElementById('tagWrapper');
    if (!wrapper) {
      console.error('ERROR: tagWrapper element not found!');
      alert('Error: tagWrapper element not found');
      return;
    }
    
    wrapper.style.opacity = '0.5';
    wrapper.style.transition = 'opacity 0.3s';
    console.log('Wrapper prepared');

    // Load the fonts needed for this design
    await loadFontsForDesign(_currentDesign);
    console.log('Design fonts loaded');

    // Update design badge
    const badgeName = document.getElementById('designBadgeName');
    const metaName = document.getElementById('previewDesignName');
    if (badgeName) badgeName.textContent = _currentDesign.name;
    if (metaName) metaName.textContent = _currentDesign.name;

    // Show/hide photo step
    const photoStep = document.getElementById('photoStep');
    if (photoStep) {
      photoStep.style.display = (_currentDesign.fields.photo && _currentDesign.fields.photo.enabled)
        ? 'flex' : 'none';
    }

    // Update tagline placeholder and default value
    const taglineInput = document.getElementById('tagline');
    if (taglineInput && _currentDesign.fields.tagline && _currentDesign.fields.tagline.defaultValue) {
      taglineInput.placeholder = _currentDesign.fields.tagline.defaultValue;
      if (!taglineInput.value) {
        taglineInput.value = _currentDesign.fields.tagline.defaultValue;
      }
    }

    // Load default photo if design has photo enabled
    if (_currentDesign.fields.photo && _currentDesign.fields.photo.enabled) {
      try {
        const res = await fetch('./couple.jpg');
        const blob = await res.blob();
        _photoDataURL = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.readAsDataURL(blob);
        });
        // Update UI to show photo is loaded
        const removeBtn = document.getElementById('photoRemoveBtn');
        const uploadLabel = document.getElementById('photoUploadLabel');
        if (removeBtn) removeBtn.style.display = 'block';
        if (uploadLabel) uploadLabel.style.display = 'none';
      } catch (e) {
        console.warn('Could not load default couple.jpg:', e);
      }
    }

    // Size the wrapper to match the design
    wrapper.style.width = _currentDesign.tagDimensions.width + 'px';
    wrapper.style.height = _currentDesign.tagDimensions.height + 'px';
    console.log(`Wrapper sized to ${_currentDesign.tagDimensions.width}x${_currentDesign.tagDimensions.height}px`);

    // Build and mount the tag element
    console.log('Building tag element...');
    _tagRoot = await window.TagRenderer.buildTagElement(_currentDesign, _getValues(), _photoDataURL);
    if (!_tagRoot) {
      console.error('ERROR: buildTagElement returned null/undefined!');
      alert('Error: Could not build tag element');
      return;
    }
    
    _tagRoot.id = 'theTag';
    console.log('Tag element created, appending to wrapper...');
    wrapper.innerHTML = '';
    wrapper.appendChild(_tagRoot);
    wrapper.style.opacity = '1';
    console.log('Tag element appended to DOM');

    console.log('Calling _doUpdateTag...');
    await _doUpdateTag();
    console.log('Preview ready!');
  } catch (err) {
    console.error('FATAL ERROR during initialization:', err);
    alert('Error: ' + err.message);
  }
});

// ─── Read form values ─────────────────────────────────────────────────────────
function _getValues() {
  return {
    name1: (document.getElementById('name1') || {}).value || '',
    name2: (document.getElementById('name2') || {}).value || '',
    date: (document.getElementById('wdate') || {}).value || '',
    tagline: (document.getElementById('tagline') || {}).value || '',
  };
}

// ─── Live update ──────────────────────────────────────────────────────────────
function updateTag() {
  clearTimeout(_updateTagTimer);
  _updateTagTimer = setTimeout(_doUpdateTag, 80);
}

async function _doUpdateTag() {
  if (!_currentDesign || !_tagRoot) return;
  await window.TagRenderer.updateTagElement(_tagRoot, _currentDesign, _getValues(), _photoDataURL);

  // Pulse
  _tagRoot.classList.remove('updating');
  requestAnimationFrame(() => requestAnimationFrame(() => _tagRoot.classList.add('updating')));
}

// ─── Photo upload ─────────────────────────────────────────────────────────────
function handlePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    _photoDataURL = e.target.result;
    const removeBtn = document.getElementById('photoRemoveBtn');
    const uploadLabel = document.getElementById('photoUploadLabel');
    if (removeBtn) removeBtn.style.display = 'block';
    if (uploadLabel) uploadLabel.style.display = 'none';
    _doUpdateTag();
  };
  reader.readAsDataURL(file);
}

function removePhoto() {
  _photoDataURL = null;
  const photoInput = document.getElementById('photoInput');
  const removeBtn = document.getElementById('photoRemoveBtn');
  const uploadLabel = document.getElementById('photoUploadLabel');

  if (photoInput) photoInput.value = '';
  if (removeBtn) removeBtn.style.display = 'none';
  if (uploadLabel) uploadLabel.style.display = 'flex';

  // Reload default photo
  if (_currentDesign.fields.photo && _currentDesign.fields.photo.enabled) {
    fetch('./couple.jpg')
      .then(res => res.blob())
      .then(blob => {
        const reader = new FileReader();
        reader.onload = (e) => {
          _photoDataURL = e.target.result;
          _doUpdateTag();
        };
        reader.readAsDataURL(blob);
      })
      .catch(e => console.warn('Could not reload default couple.jpg:', e));
  } else {
    _doUpdateTag();
  }
}

// ─── PDF Generation ───────────────────────────────────────────────────────────
async function generatePDF() {
  const btn = document.getElementById('btnDownload');
  const v = _getValues();
  const n1 = v.name1 || 'Taylor';
  const n2 = v.name2 || 'Cynthia';
  const filename = `wedding-tags-${n1}-${n2}-${(_currentDesign || {}).id || 'custom'}`
    .toLowerCase().replace(/\s+/g, '-') + '.pdf';

  btn.disabled = true;
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite">
      <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
      <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/>
    </svg>
    Generating PDF…`;

  try {
    // Ensure fonts are loaded before PDF generation
    await loadFontsForDesign(_currentDesign);

    try { if (document.fonts?.ready) await document.fonts.ready; } catch (_) { }

    // Build the tag canvas at full size for high-quality PDF
    const A4_W_MM = 210, A4_H_MM = 297;
    const COLS = 4, ROWS = 3, MARGIN_MM = 8, GAP_MM = 4;

    const tagW_MM = (A4_W_MM - MARGIN_MM * 2 - GAP_MM * (COLS - 1)) / COLS;
    const tagH_MM = (A4_H_MM - MARGIN_MM * 2 - GAP_MM * (ROWS - 1)) / ROWS;

    // Build canvas at PDF print size
    const tagCanvas = await window.TagRenderer.buildTagCanvas(_currentDesign, _getValues(), _photoDataURL);

    // Convert canvas to PNG data URL
    const imgData = tagCanvas.toDataURL('image/png');

    // Create PDF and add the image to all 12 tag positions
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, A4_W_MM, A4_H_MM, 'F');

    const ALIAS = 'tag';
    pdf.addImage(imgData, 'PNG', MARGIN_MM, MARGIN_MM, tagW_MM, tagH_MM, ALIAS, 'NONE');
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (row === 0 && col === 0) continue;
        pdf.addImage(imgData, 'PNG',
          MARGIN_MM + col * (tagW_MM + GAP_MM),
          MARGIN_MM + row * (tagH_MM + GAP_MM),
          tagW_MM, tagH_MM, ALIAS, 'NONE');
      }
    }

    pdf.setFontSize(5);
    pdf.setTextColor(180, 160, 140);
    pdf.text(
      `HeavenXent Keepsakes · ${(_currentDesign || {}).name || 'Custom'} · 12 Custom Wedding Tags · Print at 100% on A4`,
      A4_W_MM / 2, A4_H_MM - 2.5, { align: 'center' }
    );
    pdf.save(filename);

  } catch (err) {
    console.error('PDF generation failed:', err);
    alert(`Oops — could not generate the PDF.\n\n${err?.message || ''}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Download PDF — 12 Tags`;
  }
}

async function handleBuyPDF() {
  try {
    const btn = document.getElementById("btnDownload");
    btn.innerText = "Preparing your design...";
    btn.disabled = true;

    // ✅ Keep the preview intact
    if (!_tagRoot) {
      console.warn('Tag preview not found!');
    }

    // ✅ Generate PDF silently (no DOM change)
    const pdfBlob = await generatePDFBlob();

    const arrayBuffer = await pdfBlob.arrayBuffer();
    const base64PDF = btoa(
      new Uint8Array(arrayBuffer)
        .reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    btn.innerText = "Redirecting to checkout...";

    const res = await fetch("https://api.heavenxentph.com/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test User",
        email: "test@email.com",
        type: "PDF",
        pdf: base64PDF
      })
    });

    const data = await res.json();

    console.log("Checkout response:", data);

    if (data.checkout_url) {
      window.location.href = data.checkout_url;
    } else {
      throw new Error("No checkout URL returned");
    }

  } catch (err) {
    console.error(err);
    alert("Something went wrong. Please try again.");
    const btn = document.getElementById("btnDownload");
    btn.innerText = "Buy & Download PDF — ₱149";
    btn.disabled = false;
  }
}

//function to generate PDF blob without triggering download

async function generatePDFBlob() {
  // Similar to generatePDF but returns a Blob instead of saving
  const v = _getValues();
  const n1 = v.name1 || 'Taylor';
  const n2 = v.name2 || 'Cynthia';

  // Build the tag canvas at full size for high-quality PDF
  const A4_W_MM = 210, A4_H_MM = 297;
  const COLS = 4, ROWS = 3, MARGIN_MM = 8, GAP_MM = 4;

  const tagW_MM = (A4_W_MM - MARGIN_MM * 2 - GAP_MM * (COLS - 1)) / COLS;
  const tagH_MM = (A4_H_MM - MARGIN_MM * 2 - GAP_MM * (ROWS - 1)) / ROWS;

  const tagCanvas = await window.TagRenderer.buildTagCanvas(_currentDesign, _getValues(), _photoDataURL);

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
      pdf.addImage(imgData, 'PNG',
        MARGIN_MM + col * (tagW_MM + GAP_MM),
        MARGIN_MM + row * (tagH_MM + GAP_MM),
        tagW_MM, tagH_MM, ALIAS, 'NONE');
    }
  }

  pdf.setFontSize(5);
  pdf.setTextColor(180, 160, 140);
  pdf.text(
    `HeavenXent Keepsakes · ${(_currentDesign || {}).name || 'Custom'} · 12 Custom Wedding Tags · Print at 100% on A4`,
    A4_W_MM / 2, A4_H_MM - 2.5, { align: 'center' }
  );

  const pdfBlob = pdf.output('blob');
  return pdfBlob;
}


// Expose functions to global scope
window.generatePDF = generatePDF;
window.updateTag = updateTag;
window.handleBuyPDF = handleBuyPDF;
window.generatePDFBlob = generatePDFBlob;
window.handlePhotoUpload = handlePhotoUpload;
window.removePhoto = removePhoto;