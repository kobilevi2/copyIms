(() => {
  const IMAGE_BATCH_SIZE = 150;

  const state = {
    originRoot: '',
    targetRoot: '',
    continueFromLast: false,
    convertHeic: true,
    currentRel: '',
    mergeActive: false,
    configured: false,
    pendingImages: [],
    imagesRendered: 0,
    imageObserver: null,
    warmPolling: false,
  };

  const els = {
    originRoot: document.getElementById('originRoot'),
    targetRoot: document.getElementById('targetRoot'),
    browseOrigin: document.getElementById('browseOrigin'),
    browseTarget: document.getElementById('browseTarget'),
    continueFromLast: document.getElementById('continueFromLast'),
    convertHeic: document.getElementById('convertHeic'),
    saveConfig: document.getElementById('saveConfig'),
    statusMessage: document.getElementById('statusMessage'),
    warmStatus: document.getElementById('warmStatus'),
    breadcrumb: document.getElementById('breadcrumb'),
    mergeToggle: document.getElementById('mergeToggle'),
    grid: document.getElementById('grid'),
    emptyMessage: document.getElementById('emptyMessage'),
    lightbox: document.getElementById('lightbox'),
    lightboxImg: document.getElementById('lightboxImg'),
    lightboxLoading: document.getElementById('lightboxLoading'),
    lightboxCaption: document.getElementById('lightboxCaption'),
  };

  function showStatus(message, type) {
    if (!message) {
      els.statusMessage.hidden = true;
      return;
    }
    els.statusMessage.textContent = message;
    els.statusMessage.className = 'status-message ' + (type || 'info');
    els.statusMessage.hidden = false;
  }

  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      data = null;
    }
    if (!res.ok) {
      const message = (data && data.error) || `Request failed (${res.status})`;
      throw new Error(message);
    }
    return data;
  }

  function renderBreadcrumb(breadcrumb) {
    els.breadcrumb.innerHTML = '';
    breadcrumb.forEach((crumb, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.textContent = '/';
        els.breadcrumb.appendChild(sep);
      }
      const link = document.createElement('a');
      link.textContent = crumb.name;
      // Navigating anywhere via the breadcrumb always leaves merge mode --
      // it's scoped to the folder you turned it on for.
      link.addEventListener('click', () => loadFolder(crumb.rel, false));
      els.breadcrumb.appendChild(link);
    });
  }

  function makeFolderTile(folder) {
    const tile = document.createElement('div');
    tile.className = 'tile folder-tile';

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const icon = document.createElement('span');
    icon.className = 'folder-icon';
    icon.textContent = '📁';
    thumb.appendChild(icon);

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = folder.name;

    tile.appendChild(thumb);
    tile.appendChild(label);
    tile.addEventListener('click', () => loadFolder(folder.rel, false));

    // "Fully copied" is a recursive check over the whole subtree, so it's
    // deliberately not part of the main folder listing (that would make
    // opening a folder as slow as scanning everything under it). Fetched
    // separately per tile so the grid itself never waits on it.
    fetchJson('/api/folder-status?rel=' + encodeURIComponent(folder.rel))
      .then((status) => {
        if (!status.fullyCopied) return;
        tile.classList.add('fully-copied');
        if (!tile.querySelector('.badge')) {
          const badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = '✓';
          tile.appendChild(badge);
        }
      })
      .catch(() => {
        // Non-critical -- the folder tile just stays without a badge.
      });

    return tile;
  }

  function makeImageTile(image) {
    const tile = document.createElement('div');
    tile.className = 'tile image-tile' + (image.copied ? ' copied' : '');

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = '/api/thumbnail?rel=' + encodeURIComponent(image.rel);
    img.alt = image.name;
    thumb.appendChild(img);

    if (image.copied) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = '✓';
      tile.appendChild(badge);
    }

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = image.name;

    tile.appendChild(thumb);
    tile.appendChild(label);

    if (image.convertsToJpg) {
      const convertTag = document.createElement('div');
      convertTag.className = 'convert-tag';
      convertTag.textContent = 'HEIC → JPG';
      tile.appendChild(convertTag);
    }

    if (image.sourceFolder) {
      const sourceTag = document.createElement('div');
      sourceTag.className = 'source-tag';
      sourceTag.textContent = 'from ' + image.sourceFolder;
      sourceTag.title = image.sourceFolder;
      tile.appendChild(sourceTag);
    }

    // Right-click opens the large preview instead of the browser's context
    // menu, keeping left-click free for the one-click copy.
    tile.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openLightbox(state.pendingImages.indexOf(image));
    });

    tile.addEventListener('click', async () => {
      if (tile.classList.contains('copied')) return; // one-way copy, no-op once copied
      try {
        const body = { rel: image.rel };
        // Merge mode: the destination collapses to directly under the folder
        // merge was turned on for, instead of mirroring the real nested path.
        if (state.mergeActive) body.mergeRoot = state.currentRel;
        const result = await fetchJson('/api/copy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (result.ok) {
          tile.classList.add('copied');
          if (!tile.querySelector('.badge')) {
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = '✓';
            tile.appendChild(badge);
          }
        }
      } catch (err) {
        showStatus(err.message, 'error');
      }
    });

    return tile;
  }

  // Large preview of a single image. Index is into state.pendingImages so the
  // arrow keys can step through the whole folder, including images whose
  // tiles haven't been rendered yet.
  let lightboxIndex = -1;

  function openLightbox(index) {
    const image = state.pendingImages[index];
    if (!image || (index === lightboxIndex && !els.lightbox.hidden)) return;
    lightboxIndex = index;
    els.lightboxLoading.textContent = 'Loading…';
    els.lightboxLoading.hidden = false;
    els.lightboxImg.hidden = true;
    els.lightboxImg.src = '/api/image?rel=' + encodeURIComponent(image.rel);
    els.lightboxImg.alt = image.name;
    els.lightboxCaption.textContent = `${image.name}  (${index + 1} / ${state.pendingImages.length})`;
    els.lightbox.hidden = false;
  }

  function closeLightbox() {
    els.lightbox.hidden = true;
    els.lightboxImg.removeAttribute('src');
    lightboxIndex = -1;
  }

  els.lightboxImg.addEventListener('load', () => {
    els.lightboxLoading.hidden = true;
    els.lightboxImg.hidden = false;
  });
  els.lightboxImg.addEventListener('error', () => {
    if (!els.lightboxImg.getAttribute('src')) return; // cleared on close
    els.lightboxLoading.hidden = false;
    els.lightboxLoading.textContent = 'Could not load this image.';
  });
  els.lightbox.addEventListener('click', closeLightbox);
  els.lightbox.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    closeLightbox();
  });

  document.addEventListener('keydown', (e) => {
    if (els.lightbox.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowRight') openLightbox(Math.min(lightboxIndex + 1, state.pendingImages.length - 1));
    else if (e.key === 'ArrowLeft') openLightbox(Math.max(lightboxIndex - 1, 0));
  });

  // Renders images in batches instead of all at once, so a folder with
  // thousands of images doesn't have to build/paint that many tiles up front.
  // A sentinel element at the end of the grid triggers the next batch via
  // IntersectionObserver as the user scrolls near it.
  function renderNextImageBatch() {
    const oldSentinel = document.getElementById('loadMoreSentinel');
    if (oldSentinel) oldSentinel.remove();

    const remaining = state.pendingImages.length - state.imagesRendered;
    if (remaining <= 0) return;

    const batch = state.pendingImages.slice(state.imagesRendered, state.imagesRendered + IMAGE_BATCH_SIZE);
    batch.forEach((image) => els.grid.appendChild(makeImageTile(image)));
    state.imagesRendered += batch.length;

    if (state.imagesRendered >= state.pendingImages.length) return;

    const sentinel = document.createElement('div');
    sentinel.id = 'loadMoreSentinel';
    sentinel.className = 'load-more-sentinel';
    els.grid.appendChild(sentinel);

    state.imageObserver = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        state.imageObserver.disconnect();
        renderNextImageBatch();
      }
    }, { rootMargin: '600px' });
    state.imageObserver.observe(sentinel);
  }

  async function loadFolder(rel, merge) {
    if (!state.configured) return;
    try {
      let url = '/api/browse?rel=' + encodeURIComponent(rel || '');
      if (merge) url += '&merge=true';
      const data = await fetchJson(url);
      state.currentRel = data.rel;
      state.mergeActive = !!data.merged;
      els.mergeToggle.checked = state.mergeActive;
      renderBreadcrumb(data.breadcrumb);

      if (state.imageObserver) {
        state.imageObserver.disconnect();
        state.imageObserver = null;
      }

      els.grid.innerHTML = '';
      const hasContent = data.folders.length > 0 || data.images.length > 0;
      els.emptyMessage.hidden = hasContent;
      if (!hasContent) {
        els.emptyMessage.textContent = 'This folder is empty.';
      }

      data.folders.forEach((folder) => els.grid.appendChild(makeFolderTile(folder)));

      state.pendingImages = data.images;
      state.imagesRendered = 0;
      renderNextImageBatch();
    } catch (err) {
      showStatus(err.message, 'error');
    }
  }

  async function init() {
    try {
      const config = await fetchJson('/api/config');
      state.originRoot = config.originRoot || '';
      state.targetRoot = config.targetRoot || '';
      state.continueFromLast = !!config.continueFromLast;
      state.convertHeic = config.convertHeic === undefined ? true : !!config.convertHeic;

      els.originRoot.value = state.originRoot;
      els.targetRoot.value = state.targetRoot;
      els.continueFromLast.checked = state.continueFromLast;
      els.convertHeic.checked = state.convertHeic;

      state.configured = !!(state.originRoot && state.targetRoot);

      if (state.configured) {
        let startRel = '';
        if (state.continueFromLast) {
          showStatus('Determining where you left off…', 'info');
          try {
            const resume = await fetchJson('/api/resume');
            startRel = resume.rel || '';
          } catch (err) {
            startRel = '';
          }
        } else {
          showStatus('Loading your photos…', 'info');
        }
        await loadFolder(startRel);
        showStatus(null);
        startWarmPolling();
      } else {
        els.emptyMessage.hidden = false;
        els.emptyMessage.textContent = 'Enter and save the origin and target root directories to begin.';
      }
    } catch (err) {
      showStatus(err.message, 'error');
    }
  }

  els.saveConfig.addEventListener('click', async () => {
    els.saveConfig.disabled = true;
    showStatus('Saving…', 'info');
    try {
      const payload = {
        originRoot: els.originRoot.value.trim(),
        targetRoot: els.targetRoot.value.trim(),
        continueFromLast: els.continueFromLast.checked,
        convertHeic: els.convertHeic.checked,
      };
      const result = await fetchJson('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      state.originRoot = result.originRoot;
      state.targetRoot = result.targetRoot;
      state.continueFromLast = result.continueFromLast;
      state.convertHeic = result.convertHeic;
      state.configured = true;

      let startRel = '';
      if (state.continueFromLast) {
        showStatus('Saved. Determining where you left off…', 'info');
        const resume = await fetchJson('/api/resume');
        startRel = resume.rel || '';
      } else {
        showStatus('Saved. Loading your photos…', 'info');
      }
      await loadFolder(startRel);
      showStatus('Saved.', 'info');
      startWarmPolling();
    } catch (err) {
      showStatus(err.message, 'error');
    } finally {
      els.saveConfig.disabled = false;
    }
  });

  async function browseFor(inputEl, buttonEl) {
    buttonEl.disabled = true;
    const originalLabel = buttonEl.textContent;
    buttonEl.textContent = 'Waiting for dialog…';
    try {
      const initial = inputEl.value.trim();
      const data = await fetchJson('/api/pick-folder?initial=' + encodeURIComponent(initial));
      if (data.path) {
        inputEl.value = data.path;
        showStatus('Folder selected. Click Save to apply it.', 'info');
      }
    } catch (err) {
      showStatus(err.message, 'error');
    } finally {
      buttonEl.disabled = false;
      buttonEl.textContent = originalLabel;
    }
  }

  els.browseOrigin.addEventListener('click', () => browseFor(els.originRoot, els.browseOrigin));
  els.browseTarget.addEventListener('click', () => browseFor(els.targetRoot, els.browseTarget));

  els.mergeToggle.addEventListener('change', () => {
    loadFolder(state.currentRel, els.mergeToggle.checked);
  });

  // The server pre-warms thumbnails for the whole origin tree in the
  // background (started on Save, or automatically on server startup if a
  // root was already configured). This just polls to show progress -- it
  // doesn't trigger the sweep itself.
  function renderWarmStatus(status) {
    if (!status || !status.running) {
      els.warmStatus.hidden = true;
      return;
    }

    els.warmStatus.hidden = false;
    els.warmStatus.innerHTML = '';

    if (!status.total) {
      els.warmStatus.textContent = 'Scanning folder for images…';
      return;
    }

    const pct = Math.round((status.done / status.total) * 100);

    const bar = document.createElement('span');
    bar.className = 'bar';
    const fill = document.createElement('span');
    fill.className = 'bar-fill';
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    els.warmStatus.appendChild(bar);

    const text = document.createElement('span');
    text.textContent = `Preparing thumbnails: ${status.done} / ${status.total} (${pct}%)`;
    els.warmStatus.appendChild(text);
  }

  async function pollWarmStatus() {
    try {
      const status = await fetchJson('/api/thumbnail-status');
      renderWarmStatus(status);
      if (status.running) {
        setTimeout(pollWarmStatus, 1500);
        return;
      }
    } catch (err) {
      // Non-critical -- just stop polling silently on error.
    }
    state.warmPolling = false;
  }

  function startWarmPolling() {
    if (state.warmPolling) return;
    state.warmPolling = true;
    pollWarmStatus();
  }

  init();
})();
