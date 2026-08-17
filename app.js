/* InstaFollower PWA v1.2.7 · GitHub Pages privacy build */
(() => {
  'use strict';

  const DB_NAME = 'InstaFollowerDB';
  const DB_VERSION = 1;
  const STORE = 'kv';
  const PAGE_SIZE = 90;
  const VALID_USERNAME = /^[a-zA-Z0-9._]{1,30}$/;

  const state = {
    db: null,
    snapshots: [],
    currentSnapshot: null,
    classifications: {},
    likes: {},
    likeImports: [],
    settings: { openMode: 'intent' },
    filter: 'all',
    profileSearch: '',
    likesSearch: '',
    sort: 'username',
    renderLimit: PAGE_SIZE,
    filteredProfiles: [],
    deferredInstallPrompt: null,
    lastComparison: null,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function normalizeUsername(value) {
    return String(value || '')
      .trim()
      .replace(/^@+/, '')
      .replace(/^https?:\/\/(?:www\.)?instagram\.com\/(?:_u\/)?/i, '')
      .replace(/[/?#].*$/, '')
      .trim()
      .toLowerCase();
  }

  function isUsername(value) {
    const u = normalizeUsername(value);
    return VALID_USERNAME.test(u);
  }

  function formatDate(iso) {
    try {
      return new Intl.DateTimeFormat('es-CO', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      }).format(new Date(iso));
    } catch { return new Date(iso).toLocaleString(); }
  }

  function formatNumber(n) {
    return new Intl.NumberFormat('es-CO').format(Number(n || 0));
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[c]));
  }

  function initials(username) {
    const clean = String(username || '?').replace(/[._]/g, ' ').trim();
    return clean.slice(0, 2).toUpperCase() || '?';
  }

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function openModal(html) {
    $('#modalBody').innerHTML = html;
    $('#modalBackdrop').classList.remove('hidden');
  }

  function closeModal() {
    $('#modalBackdrop').classList.add('hidden');
    $('#modalBody').innerHTML = '';
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function dbGet(key, fallback) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result === undefined ? fallback : req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function dbSet(key, value) {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function dbClear() {
    return new Promise((resolve, reject) => {
      const tx = state.db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadState() {
    state.snapshots = await dbGet('snapshots', []);
    state.classifications = await dbGet('classifications', {});
    state.likes = await dbGet('likes', {});
    state.likeImports = await dbGet('likeImports', []);
    state.settings = { openMode: 'intent', ...(await dbGet('settings', {})) };
    const currentId = await dbGet('currentSnapshotId', null);
    state.currentSnapshot = state.snapshots.find(s => s.id === currentId) || state.snapshots.at(-1) || null;
  }


  function isNativeAndroidShell() {
    return !!window.AndroidBridge || /^file:\/\/\/android_asset\//i.test(location.href);
  }


  async function sha256Hex(input) {
    const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new TextEncoder().encode(String(input));
    if (crypto?.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback simple para modo file:// en navegadores donde SubtleCrypto no esté expuesto.
    let h1 = 2166136261;
    for (const b of bytes) { h1 ^= b; h1 = Math.imul(h1, 16777619); }
    return `fnv-${(h1 >>> 0).toString(16)}-${bytes.length}`;
  }

  function extractFollowersFromJSON(data) {
    const out = new Set();
    const rows = Array.isArray(data) ? data : [];
    for (const item of rows) {
      const candidates = [];
      if (item?.title) candidates.push(item.title);
      for (const s of item?.string_list_data || []) {
        if (s?.value) candidates.push(s.value);
        if (s?.href) candidates.push(s.href);
      }
      for (const c of candidates) {
        const u = normalizeUsername(c);
        if (isUsername(u)) { out.add(u); break; }
      }
    }
    return out;
  }

  function extractFollowingFromJSON(data) {
    const rows = Array.isArray(data)
      ? data
      : (data?.relationships_following || data?.following || []);
    const out = new Set();
    for (const item of rows) {
      const candidates = [];
      if (item?.title) candidates.push(item.title);
      for (const s of item?.string_list_data || []) {
        if (s?.value) candidates.push(s.value);
        if (s?.href) candidates.push(s.href);
      }
      for (const c of candidates) {
        const u = normalizeUsername(c);
        if (isUsername(u)) { out.add(u); break; }
      }
    }
    return out;
  }

  async function parseInstagramZip(file) {
    const reader = await InstaZip.ZipReader.fromFile(file);
    const names = reader.list();
    const followerEntries = reader.entries.filter(e => /(^|\/)followers(?:_\d+)?\.json$/i.test(e.name));
    const followingEntry = reader.find(e => /(^|\/)following\.json$/i.test(e.name));

    if (!followerEntries.length) {
      throw new Error('No encontré followers_1.json (ni archivos followers_N.json) dentro del ZIP. Asegúrate de exportar Seguidores y seguidos en formato JSON.');
    }
    if (!followingEntry) {
      throw new Error('No encontré following.json dentro del ZIP. Asegúrate de exportar Seguidores y seguidos en formato JSON.');
    }

    const followers = new Set();
    for (const entry of followerEntries) {
      const data = await reader.json(entry);
      for (const u of extractFollowersFromJSON(data)) followers.add(u);
    }
    const followingData = await reader.json(followingEntry);
    const following = extractFollowingFromJSON(followingData);

    if (!following.size && !followers.size) throw new Error('Los archivos de Instagram se encontraron, pero no contienen cuentas reconocibles.');

    return {
      followers: [...followers].sort(),
      following: [...following].sort(),
      detectedFiles: [...followerEntries.map(e => e.name), followingEntry.name],
      zipEntries: names.length,
    };
  }

  function setDiff(a, b) {
    const bs = b instanceof Set ? b : new Set(b);
    return [...a].filter(x => !bs.has(x));
  }

  function compareSnapshots(prev, curr) {
    if (!prev || !curr) return null;
    const pf = new Set(prev.followers), cf = new Set(curr.followers);
    const pg = new Set(prev.following), cg = new Set(curr.following);
    const pm = new Set(prev.following.filter(u => pf.has(u)));
    const cm = new Set(curr.following.filter(u => cf.has(u)));
    const pnb = new Set(prev.following.filter(u => !pf.has(u)));
    const cnb = new Set(curr.following.filter(u => !cf.has(u)));
    return {
      gainedFollowers: setDiff(cf, pf),
      lostFollowers: setDiff(pf, cf),
      newlyFollowing: setDiff(cg, pg),
      unfollowed: setDiff(pg, cg),
      nowFollowsBack: setDiff(cm, pm),
      stoppedFollowingBack: setDiff(pm, cm),
      newNotBack: setDiff(cnb, pnb),
      noLongerNotBack: setDiff(pnb, cnb),
    };
  }

  async function importZip(file) {
    if (!file) return;
    toast('Leyendo exportación…');
    try {
      const parsed = await parseInstagramZip(file);
      const prev = state.currentSnapshot;
      const snapshot = {
        id: crypto.randomUUID ? crypto.randomUUID() : `snap-${Date.now()}-${Math.random()}`,
        importedAt: new Date().toISOString(),
        sourceName: file.name,
        sourceSize: file.size,
        sourceLastModified: file.lastModified ? new Date(file.lastModified).toISOString() : null,
        followers: parsed.followers,
        following: parsed.following,
        detectedFiles: parsed.detectedFiles,
      };
      snapshot.stats = computeStats(snapshot);

      state.snapshots.push(snapshot);
      state.currentSnapshot = snapshot;
      state.lastComparison = compareSnapshots(prev, snapshot);
      await dbSet('snapshots', state.snapshots);
      await dbSet('currentSnapshotId', snapshot.id);
      renderAll();
      showImportResult(prev, snapshot, state.lastComparison);
      toast(`Importado: ${formatNumber(snapshot.followers.length)} seguidores`);
    } catch (err) {
      console.error(err);
      openModal(`
        <h2>No pude leer el ZIP</h2>
        <p>${escapeHTML(err.message || String(err))}</p>
        <div class="modal-actions"><button class="secondary-btn wide" type="button" data-close-modal>Entendido</button></div>
      `);
    }
  }

  function computeStats(snapshot) {
    if (!snapshot) return { following: 0, followers: 0, mutual: 0, notBack: 0, fans: 0 };
    const followers = new Set(snapshot.followers);
    const following = new Set(snapshot.following);
    let mutual = 0;
    for (const u of following) if (followers.has(u)) mutual++;
    return {
      following: following.size,
      followers: followers.size,
      mutual,
      notBack: following.size - mutual,
      fans: followers.size - mutual,
    };
  }

  function isBlocked(username) {
    return !!state.classifications[normalizeUsername(username)]?.blocked;
  }

  // Estadísticas visibles de la app. Los snapshots conservan el ZIP crudo,
  // pero las cuentas marcadas como Bloqueadas dejan de formar parte de las
  // listas y contadores activos hasta que el usuario las quite de Bloqueados.
  function visibleStats(snapshot) {
    if (!snapshot) return { following: 0, followers: 0, mutual: 0, notBack: 0, fans: 0 };
    const followers = new Set(snapshot.followers.filter(u => !isBlocked(u)));
    const following = new Set(snapshot.following.filter(u => !isBlocked(u)));
    let mutual = 0;
    for (const u of following) if (followers.has(u)) mutual++;
    return {
      following: following.size,
      followers: followers.size,
      mutual,
      notBack: following.size - mutual,
      fans: followers.size - mutual,
    };
  }

  function unblockedUsers(usernames) {
    return (usernames || []).filter(username => !isBlocked(username));
  }

  // En la categoría “No te siguen” solo contamos cuentas personales normales.
  // Las cuentas marcadas manualmente como Personaje/Tienda se mantienen separadas.
  function personalNotBackCount(snapshot) {
    if (!snapshot) return 0;
    const followers = new Set(snapshot.followers);
    return snapshot.following.reduce((total, username) => {
      const isSpecial = !!state.classifications[username]?.special;
      const blocked = !!state.classifications[username]?.blocked;
      return total + (!followers.has(username) && !isSpecial && !blocked ? 1 : 0);
    }, 0);
  }

  function personalComparisonUsers(usernames) {
    return (usernames || []).filter(username => !state.classifications[username]?.special && !isBlocked(username));
  }

  // Cuentas que aparecen por primera vez entre los seguidos del snapshot actual
  // respecto al ZIP inmediatamente anterior. La lista se deriva de los snapshots,
  // así que también sobrevive a recargas y restauraciones de respaldo.
  function currentNewlyFollowingSet() {
    const curr = state.currentSnapshot;
    if (!curr) return new Set();
    const idx = state.snapshots.findIndex(s => s.id === curr.id);
    if (idx <= 0) return new Set();
    const prev = state.snapshots[idx - 1];
    return new Set(compareSnapshots(prev, curr)?.newlyFollowing || []);
  }

  function showImportResult(prev, snapshot, comp) {
    const s = visibleStats(snapshot);
    if (!prev || !comp) {
      openModal(`
        <h2>Exportación cargada</h2>
        <p>${escapeHTML(snapshot.sourceName)} · ${escapeHTML(formatDate(snapshot.importedAt))}</p>
        <div class="delta-grid">
          <div class="delta"><span>Siguiendo</span><strong>${formatNumber(s.following)}</strong></div>
          <div class="delta"><span>Seguidores</span><strong>${formatNumber(s.followers)}</strong></div>
          <div class="delta positive"><span>Te siguen</span><strong>${formatNumber(s.mutual)}</strong></div>
          <div class="delta negative"><span>No te siguen</span><strong>${formatNumber(personalNotBackCount(snapshot))}</strong></div>
        </div>
        <p>Este será el punto de comparación para la próxima exportación que cargues.</p>
        <div class="modal-actions"><button class="primary-btn wide" type="button" data-close-modal>Ver cuentas</button></div>
      `);
      return;
    }
    openModal(`
      <h2>Cambios detectados</h2>
      <p>${escapeHTML(formatDate(prev.importedAt))} → ${escapeHTML(formatDate(snapshot.importedAt))}</p>
      <div class="delta-grid">
        <div class="delta positive"><span>Nuevos seguidores</span><strong>+${formatNumber(comp.gainedFollowers.length)}</strong></div>
        <div class="delta negative"><span>Dejaron de seguirte</span><strong>−${formatNumber(comp.lostFollowers.length)}</strong></div>
        <div class="delta positive"><span>Ahora te siguen</span><strong>+${formatNumber(unblockedUsers(comp.nowFollowsBack).length)}</strong></div>
        <div class="delta negative"><span>Ya no te siguen</span><strong>−${formatNumber(personalComparisonUsers(comp.stoppedFollowingBack).length)}</strong></div>
        <div class="delta"><span>Nuevos seguidos</span><strong>+${formatNumber(unblockedUsers(comp.newlyFollowing).length)}</strong></div>
        <div class="delta"><span>Dejaste de seguir</span><strong>−${formatNumber(unblockedUsers(comp.unfollowed).length)}</strong></div>
      </div>
      <p>El snapshot anterior permanece guardado en Ajustes → Historial de exportaciones.</p>
      <div class="modal-actions"><button class="primary-btn wide" type="button" data-close-modal>Ver lista actual</button></div>
    `);
  }

  function buildProfiles() {
    const snap = state.currentSnapshot;
    if (!snap) return [];
    const followers = new Set(snap.followers);
    const newAccounts = currentNewlyFollowingSet();
    return snap.following.map(username => ({
      username,
      followsBack: followers.has(username),
      special: !!state.classifications[username]?.special,
      blocked: !!state.classifications[username]?.blocked,
      isNew: newAccounts.has(username),
      likes: state.likes[username]?.count || 0,
      displayName: state.likes[username]?.displayName || '',
    }));
  }

  function getFilteredProfiles() {
    const snap = state.currentSnapshot;
    if (!snap) return [];
    const followers = new Set(snap.followers);
    const newAccounts = currentNewlyFollowingSet();

    // Bloqueados es una lista local persistente y puede contener cuentas que ya
    // no aparecen en el ZIP actual. Por eso se construye desde classifications.
    let rows;
    if (state.filter === 'blocked') {
      rows = Object.entries(state.classifications)
        .filter(([, info]) => !!info?.blocked)
        .map(([username, info]) => ({
          username,
          followsBack: followers.has(username),
          special: !!info?.special,
          blocked: true,
          isNew: false,
          likes: state.likes[username]?.count || 0,
          displayName: state.likes[username]?.displayName || '',
        }));
    } else {
      rows = snap.following
        .filter(username => !isBlocked(username))
        .map(username => ({
          username,
          followsBack: followers.has(username),
          special: !!state.classifications[username]?.special,
          blocked: false,
          isNew: newAccounts.has(username),
          likes: state.likes[username]?.count || 0,
          displayName: state.likes[username]?.displayName || '',
        }));
    }

    const q = state.profileSearch.trim().toLowerCase();
    if (q) rows = rows.filter(p => p.username.includes(q) || p.displayName.toLowerCase().includes(q));
    if (state.filter === 'mutual') rows = rows.filter(p => p.followsBack);
    if (state.filter === 'notback') rows = rows.filter(p => !p.followsBack && !p.special);
    if (state.filter === 'special') rows = rows.filter(p => p.special);
    if (state.sort === 'likes') {
      rows.sort((a, b) => b.likes - a.likes || a.username.localeCompare(b.username));
    } else {
      rows.sort((a, b) => a.username.localeCompare(b.username));
    }
    return rows;
  }

  function profileCardHTML(p) {
    const likes = p.likes > 0
      ? `<span class="likes-pill">♥ ${formatNumber(p.likes)} ${p.likes === 1 ? 'like' : 'likes'}</span>`
      : `<span class="likes-pill zero">Sin likes</span>`;
    return `
      <article class="profile-card ${p.isNew ? 'new-account' : ''} ${p.blocked ? 'blocked-account' : ''}" data-user="${escapeHTML(p.username)}" tabindex="0" role="button" aria-label="Abrir @${escapeHTML(p.username)} en Instagram">
        <div class="avatar ${p.isNew ? 'new-account-avatar' : ''} ${p.blocked ? 'blocked-avatar' : ''}">${escapeHTML(initials(p.username))}</div>
        <div class="profile-main">
          <div class="username">@${escapeHTML(p.username)}</div>
          <div class="meta-line">
            ${p.blocked ? '<span class="badge blocked-badge">Bloqueado</span>' : `<span class="badge ${p.followsBack ? 'good' : 'bad'}">${p.followsBack ? 'Te sigue' : 'No te sigue'}</span>`}
            ${p.special ? '<span class="badge special">Personaje/Tienda</span>' : ''}
            ${p.isNew && !p.blocked ? '<span class="badge new-badge">Nueva</span>' : ''}
            ${likes}
          </div>
        </div>
        <div class="card-actions">
          <button class="tag-btn ${p.special ? 'active' : ''}" type="button" data-tag-user="${escapeHTML(p.username)}" aria-label="${p.special ? 'Quitar' : 'Marcar'} Personaje o Tienda" title="Personaje/Tienda">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7M2 7h20l-2-4H4L2 7Zm2 0v3a2 2 0 0 0 4 0V7m0 0v3a2 2 0 0 0 4 0V7m0 0v3a2 2 0 0 0 4 0V7m0 0v3a2 2 0 0 0 4 0V7"/></svg>
          </button>
          <button class="block-btn ${p.blocked ? 'active' : ''}" type="button" data-block-user="${escapeHTML(p.username)}" aria-label="${p.blocked ? 'Quitar de Bloqueados' : 'Bloquear'}" title="${p.blocked ? 'Quitar de Bloqueados' : 'Bloquear'}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m6.3 6.3 11.4 11.4"/></svg>
          </button>
          <button class="open-btn" type="button" data-open-user="${escapeHTML(p.username)}" aria-label="Abrir perfil">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </article>
    `;
  }

  function renderFollowers(options = {}) {
    const preserveDepth = !!options.preserveDepth;
    const previousRenderLimit = state.renderLimit;
    const empty = $('#emptyFollowers');
    const content = $('#followersContent');
    const snap = state.currentSnapshot;
    if (!snap) {
      empty.classList.remove('hidden');
      content.classList.add('hidden');
      $('#snapshotSubtitle').textContent = 'Carga una exportación de Instagram';
      return;
    }
    empty.classList.add('hidden');
    content.classList.remove('hidden');
    const s = visibleStats(snap);
    $('#snapshotSubtitle').textContent = `Actualizado ${formatDate(snap.importedAt)}`;
    $('#statFollowing').textContent = formatNumber(s.following);
    $('#statMutual').textContent = formatNumber(s.mutual);
    const personalNotBack = personalNotBackCount(snap);
    $('#statNotBack').textContent = formatNumber(personalNotBack);
    $('#statFans').textContent = formatNumber(s.fans);
    $('#chipAll').textContent = formatNumber(s.following);
    $('#chipMutual').textContent = formatNumber(s.mutual);
    $('#chipNotBack').textContent = formatNumber(personalNotBack);
    $('#chipSpecial').textContent = formatNumber(snap.following.filter(u => state.classifications[u]?.special && !isBlocked(u)).length);
    $('#chipBlocked').textContent = formatNumber(Object.values(state.classifications).filter(info => info?.blocked).length);

    const banner = $('#comparisonBanner');
    if (state.lastComparison && state.snapshots.length > 1) {
      const c = state.lastComparison;
      banner.innerHTML = `<b>Desde la exportación anterior:</b> +${formatNumber(c.gainedFollowers.length)} seguidores · −${formatNumber(c.lostFollowers.length)} seguidores · ${formatNumber(unblockedUsers(c.nowFollowsBack).length)} ahora te siguen · <span class="new-inline">${formatNumber(unblockedUsers(c.newlyFollowing).length)} cuentas nuevas</span>.`;
      banner.classList.remove('hidden');
    } else banner.classList.add('hidden');

    state.filteredProfiles = getFilteredProfiles();
    $('#resultCount').textContent = `${formatNumber(state.filteredProfiles.length)} ${state.filteredProfiles.length === 1 ? 'cuenta' : 'cuentas'}`;
    $('#sortBtn').textContent = state.sort === 'likes' ? 'Orden: likes' : 'Orden: usuario';
    if (preserveDepth) {
      state.renderLimit = Math.max(PAGE_SIZE, Math.min(previousRenderLimit, state.filteredProfiles.length));
    }
    renderProfileChunk(true, preserveDepth);
  }

  function renderProfileChunk(reset = false, preserveDepth = false) {
    const list = $('#profileList');
    if (reset) {
      if (!preserveDepth) state.renderLimit = PAGE_SIZE;
      list.innerHTML = '';
    }
    const currentCount = list.children.length;
    const target = Math.min(state.renderLimit, state.filteredProfiles.length);
    if (currentCount < target) {
      list.insertAdjacentHTML('beforeend', state.filteredProfiles.slice(currentCount, target).map(profileCardHTML).join(''));
    }
  }

  function getRenderedProfileCard(username) {
    const list = $('#profileList');
    if (!list) return null;
    return Array.from(list.children).find(el => el.dataset?.user === username) || null;
  }

  function captureProfileScrollAnchors(username) {
    const card = getRenderedProfileCard(username);
    if (!card) return [];
    // Guardamos varias referencias. Si la tarjeta desaparece del filtro actual
    // (p. ej. al marcarla como Tienda desde "No te siguen"), usamos la siguiente.
    return [card, card.nextElementSibling, card.previousElementSibling]
      .filter(el => el?.dataset?.user)
      .map(el => ({ username: el.dataset.user, top: el.getBoundingClientRect().top }));
  }

  function restoreProfileScrollAnchors(anchors) {
    if (!anchors?.length) return;
    requestAnimationFrame(() => {
      for (const anchor of anchors) {
        const el = getRenderedProfileCard(anchor.username);
        if (!el) continue;
        const delta = el.getBoundingClientRect().top - anchor.top;
        if (Math.abs(delta) > 0.5) window.scrollBy(0, delta);
        break;
      }
    });
  }

  async function toggleSpecial(username) {
    const u = normalizeUsername(username);
    const anchors = captureProfileScrollAnchors(u);
    const current = !!state.classifications[u]?.special;
    state.classifications[u] = { ...(state.classifications[u] || {}), special: !current, updatedAt: new Date().toISOString() };
    await dbSet('classifications', state.classifications);
    // No volvemos a las primeras 50 tarjetas al reclasificar una cuenta.
    renderFollowers({ preserveDepth: true });
    restoreProfileScrollAnchors(anchors);
    toast(!current ? `@${u} marcado como Personaje/Tienda` : `@${u} sin clasificación especial`);
  }

  async function toggleBlocked(username) {
    const u = normalizeUsername(username);
    if (!isUsername(u)) return;
    const anchors = captureProfileScrollAnchors(u);
    const current = !!state.classifications[u]?.blocked;
    const now = new Date().toISOString();
    state.classifications[u] = {
      ...(state.classifications[u] || {}),
      blocked: !current,
      updatedAt: now,
      ...(!current ? { blockedAt: now } : { unblockedAt: now }),
    };
    await dbSet('classifications', state.classifications);
    renderFollowers({ preserveDepth: true });
    renderChanges();
    renderHistory();
    restoreProfileScrollAnchors(anchors);
    toast(!current ? `@${u} añadido a Bloqueados` : `@${u} quitado de Bloqueados`);

    // Se registra primero en la PWA y luego se abre Instagram. Al volver, la
    // lista local ya refleja la acción aun cuando Instagram no exponga su estado.
    setTimeout(() => openInstagram(u), 90);
  }

  function openInstagram(username) {
    const u = normalizeUsername(username);
    if (!isUsername(u)) return;
    const web = `https://www.instagram.com/${encodeURIComponent(u)}/`;
    if (window.AndroidBridge?.openInstagram) {
      try { window.AndroidBridge.openInstagram(u, state.settings.openMode); return; }
      catch (err) { console.warn('AndroidBridge.openInstagram:', err); }
    }
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (state.settings.openMode === 'web' || !isAndroid) {
      window.location.href = web;
      return;
    }
    const fallback = encodeURIComponent(web);
    const intent = `intent://user?username=${encodeURIComponent(u)}#Intent;scheme=instagram;package=com.instagram.android;S.browser_fallback_url=${fallback};end`;
    window.location.href = intent;
  }

  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    const src = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (quoted) {
        if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else {
        if (c === '"') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
        else field += c;
      }
    }
    if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
    return rows.filter(r => r.some(x => String(x).trim()));
  }

  function likesFromCSV(text) {
    const rows = parseCSV(text);
    if (!rows.length) return [];
    const header = rows[0].map(x => String(x).trim().toLowerCase());
    let usernameIndex = header.findIndex(x => ['username', 'usuario', 'user', 'cuenta'].includes(x));
    let nameIndex = header.findIndex(x => ['nombre_mostrado', 'nombre', 'display_name', 'name'].includes(x));
    const hasHeader = usernameIndex >= 0;
    if (!hasHeader) usernameIndex = 0;
    const dataRows = hasHeader ? rows.slice(1) : rows;
    const result = [];
    for (const r of dataRows) {
      const username = normalizeUsername(r[usernameIndex]);
      if (!isUsername(username)) continue;
      result.push({ username, displayName: nameIndex >= 0 ? String(r[nameIndex] || '').trim() : '' });
    }
    return result;
  }

  function likesFromText(text) {
    const result = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      let line = raw.trim();
      if (!line) continue;
      const first = line.split(',')[0].trim();
      const username = normalizeUsername(first);
      if (!isUsername(username)) continue;
      const name = line.includes(',') ? line.slice(line.indexOf(',') + 1).trim() : '';
      result.push({ username, displayName: name });
    }
    return result;
  }

  async function addLikes(records, sourceName, fingerprint) {
    if (!records.length) {
      toast('No encontré usernames válidos.');
      return;
    }
    if (fingerprint && state.likeImports.some(i => i.fingerprint === fingerprint)) {
      toast('Este mismo lote ya fue importado.');
      return;
    }
    const now = new Date().toISOString();
    for (const rec of records) {
      const u = normalizeUsername(rec.username);
      const old = state.likes[u] || { count: 0, displayName: '' };
      state.likes[u] = {
        count: Number(old.count || 0) + 1,
        displayName: rec.displayName || old.displayName || '',
        lastImportedAt: now,
      };
    }
    state.likeImports.push({
      id: crypto.randomUUID ? crypto.randomUUID() : `likes-${Date.now()}`,
      importedAt: now,
      sourceName,
      rows: records.length,
      fingerprint: fingerprint || null,
    });
    await Promise.all([dbSet('likes', state.likes), dbSet('likeImports', state.likeImports)]);
    renderFollowers();
    renderLikes();
    toast(`${formatNumber(records.length)} likes agregados`);
  }

  async function importCSV(file) {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const text = new TextDecoder('utf-8').decode(buffer);
      const records = likesFromCSV(text);
      const fp = await sha256Hex(buffer);
      await addLikes(records, file.name, fp);
    } catch (err) {
      console.error(err);
      toast('No pude leer ese CSV.');
    }
  }

  function renderLikes() {
    const entries = Object.entries(state.likes).map(([username, info]) => ({ username, ...info }));
    const total = entries.reduce((sum, x) => sum + Number(x.count || 0), 0);
    $('#likesTotal').textContent = formatNumber(total);
    $('#likesProfiles').textContent = formatNumber(entries.filter(x => x.count > 0).length);
    const q = state.likesSearch.trim().toLowerCase();
    let rows = entries.filter(x => !q || x.username.includes(q) || String(x.displayName || '').toLowerCase().includes(q));
    rows.sort((a, b) => b.count - a.count || a.username.localeCompare(b.username));
    const list = $('#likesList');
    $('#likesEmpty').classList.toggle('hidden', entries.length > 0);
    list.innerHTML = rows.slice(0, 500).map(x => `
      <article class="profile-card" data-user="${escapeHTML(x.username)}" tabindex="0" role="button">
        <div class="avatar">${escapeHTML(initials(x.username))}</div>
        <div class="profile-main">
          <div class="username">@${escapeHTML(x.username)}</div>
          <div class="meta-line">
            <span class="badge special">♥ ${formatNumber(x.count)} ${x.count === 1 ? 'like' : 'likes'}</span>
            ${x.displayName ? `<span class="likes-pill">${escapeHTML(x.displayName)}</span>` : ''}
          </div>
        </div>
        <div class="card-actions"><button class="open-btn" type="button" data-open-user="${escapeHTML(x.username)}" aria-label="Abrir perfil"><svg viewBox="0 0 24 24"><path d="M9 18 15 12 9 6"/></svg></button></div>
      </article>
    `).join('');
  }

  function changeUserHTML(username, kind) {
    const u = normalizeUsername(username);
    const lost = kind === 'lost';
    return `
      <article class="change-user ${lost ? 'lost' : 'gained'}" data-user="${escapeHTML(u)}" role="button" tabindex="0">
        <div class="change-avatar">${escapeHTML(initials(u))}</div>
        <div class="change-user-main">
          <strong>@${escapeHTML(u)}</strong>
          <span>${lost ? 'Te dejó de seguir' : 'Nuevo seguidor'}</span>
        </div>
        <button class="open-btn" type="button" data-open-user="${escapeHTML(u)}" aria-label="Abrir perfil">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18 15 12 9 6"/></svg>
        </button>
      </article>`;
  }

  function renderChanges() {
    const empty = $('#changesEmpty');
    const root = $('#changesContent');
    if (!empty || !root) return;
    if (state.snapshots.length < 2) {
      empty.classList.remove('hidden');
      root.classList.add('hidden');
      root.innerHTML = '';
      return;
    }

    empty.classList.add('hidden');
    root.classList.remove('hidden');
    const periods = [];
    for (let i = state.snapshots.length - 1; i >= 1; i--) {
      const prev = state.snapshots[i - 1];
      const curr = state.snapshots[i];
      const comp = compareSnapshots(prev, curr);
      const lost = comp.lostFollowers;
      const gained = comp.gainedFollowers;
      const isLatest = i === state.snapshots.length - 1;
      periods.push(`
        <details class="change-period" ${isLatest ? 'open' : ''}>
          <summary>
            <div class="change-period-title">
              <strong>${escapeHTML(formatDate(prev.importedAt))} → ${escapeHTML(formatDate(curr.importedAt))}</strong>
              <span>${escapeHTML(prev.sourceName)} → ${escapeHTML(curr.sourceName)}</span>
            </div>
            <div class="change-period-counts">
              <span class="lost-count">−${formatNumber(lost.length)}</span>
              <span class="gained-count">+${formatNumber(gained.length)}</span>
            </div>
          </summary>
          <div class="change-section lost-section">
            <div class="change-section-head">
              <div><span class="change-dot lost"></span><strong>Te dejaron de seguir</strong></div>
              <span>${formatNumber(lost.length)}</span>
            </div>
            <div class="change-users">
              ${lost.length ? lost.map(u => changeUserHTML(u, 'lost')).join('') : '<div class="empty-mini">Nadie te dejó de seguir en este periodo.</div>'}
            </div>
          </div>
          <div class="change-section gained-section">
            <div class="change-section-head">
              <div><span class="change-dot gained"></span><strong>Nuevos seguidores</strong></div>
              <span>${formatNumber(gained.length)}</span>
            </div>
            <div class="change-users">
              ${gained.length ? gained.map(u => changeUserHTML(u, 'gained')).join('') : '<div class="empty-mini">No hubo nuevos seguidores en este periodo.</div>'}
            </div>
          </div>
        </details>`);
    }
    root.innerHTML = periods.join('');
  }

  function renderHistory() {
    const root = $('#historyList');
    if (!state.snapshots.length) {
      root.innerHTML = '<div class="empty-mini">Sin importaciones todavía.</div>';
      return;
    }
    root.innerHTML = [...state.snapshots].reverse().map(s => {
      const stats = s.stats || computeStats(s);
      const current = s.id === state.currentSnapshot?.id;
      const originalIndex = state.snapshots.findIndex(x => x.id === s.id);
      const prev = originalIndex > 0 ? state.snapshots[originalIndex - 1] : null;
      const histComp = prev ? compareSnapshots(prev, s) : null;
      const newCount = histComp ? unblockedUsers(histComp.newlyFollowing).length : 0;
      const lostFollowersCount = histComp ? histComp.lostFollowers.length : 0;
      return `
        <div class="history-item">
          <div class="history-top">
            <strong>${current ? '● ' : ''}${escapeHTML(s.sourceName)}</strong>
            <span>${escapeHTML(formatDate(s.importedAt))}</span>
          </div>
          <div class="history-meta">
            <span>${formatNumber(stats.followers)} seguidores</span>
            <span>${formatNumber(stats.following)} seguidos</span>
            <span>${formatNumber(personalNotBackCount(s))} no follow-back personal</span>
            ${prev ? `<span class="history-new">${formatNumber(newCount)} nuevas</span><span class="history-lost">${formatNumber(lostFollowersCount)} dejaron de seguirte</span>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  function renderSettings() {
    $$('#openModeControl button').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === state.settings.openMode));
    renderHistory();
    renderInstallHelp();
  }

  function renderInstallHelp() {
    const box = $('#installHelp');
    if (isNativeAndroidShell()) {
      box.className = 'local-note good';
      box.innerHTML = '<b>✓ Aplicación Android instalada.</b> Los ZIP, likes, clasificaciones e historial se procesan y guardan localmente en este dispositivo.';
      $('#installBtn')?.classList.add('hidden');
      return;
    }
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) {
      box.className = 'local-note good';
      box.textContent = '✓ InstaFollower está ejecutándose como aplicación instalada. El shell queda disponible offline mediante Service Worker.';
      return;
    }
    if (location.protocol === 'file:') {
      box.className = 'local-note warn';
      box.innerHTML = '<b>Modo archivo local:</b> la app puede abrirse, pero Android/Chrome no puede instalar una PWA desde <code>file://</code>. Sirve esta carpeta en el propio teléfono mediante <b>http://localhost</b> o <b>http://127.0.0.1</b> para habilitar instalación y Service Worker.';
      return;
    }
    if (!window.isSecureContext) {
      box.className = 'local-note warn';
      box.textContent = 'Este origen no es seguro para Service Worker. Usa HTTPS o localhost/127.0.0.1.';
      return;
    }
    box.className = 'local-note good';
    box.textContent = '✓ Origen compatible con PWA. Si no aparece el botón Instalar, usa el menú del navegador → Instalar aplicación / Añadir a pantalla de inicio.';
  }

  function renderAll() {
    renderFollowers();
    renderChanges();
    renderLikes();
    renderSettings();
  }

  async function importPrivateData(file) {
    if (!file) return;
    try {
      const raw = await file.text();
      const data = JSON.parse(raw);
      if (data?.app !== 'InstaFollowerPrivateData' || !data.likes || !Array.isArray(data.specials)) {
        throw new Error('Formato privado no reconocido');
      }

      const fingerprint = await sha256Hex(raw);
      const importId = `private:${fingerprint}`;
      const now = new Date().toISOString();
      let likeRows = 0;
      let likeProfiles = 0;
      let specialsAdded = 0;

      for (const [rawUser, info] of Object.entries(data.likes || {})) {
        const u = normalizeUsername(rawUser);
        if (!isUsername(u)) continue;
        const incoming = Math.max(0, Number(info?.count || 0));
        if (!incoming) continue;
        const old = state.likes[u] || { count: 0, displayName: '' };
        state.likes[u] = {
          count: Math.max(Number(old.count || 0), incoming),
          displayName: old.displayName || info?.displayName || '',
          lastImportedAt: old.lastImportedAt || data.exportedAt || now,
        };
        likeRows += incoming;
        likeProfiles += 1;
      }

      for (const rawUser of data.specials) {
        const u = normalizeUsername(rawUser);
        if (!isUsername(u)) continue;
        if (!state.classifications[u]?.special) specialsAdded += 1;
        state.classifications[u] = {
          ...(state.classifications[u] || {}),
          special: true,
          updatedAt: data.exportedAt || now,
        };
      }

      if (!state.likeImports.some(i => i.id === importId)) {
        state.likeImports.push({
          id: importId,
          importedAt: data.exportedAt || now,
          sourceName: file.name || 'Datos privados',
          rows: likeRows,
          fingerprint,
          privateImport: true,
        });
      }

      await Promise.all([
        dbSet('likes', state.likes),
        dbSet('likeImports', state.likeImports),
        dbSet('classifications', state.classifications),
      ]);
      renderAll();
      toast(`Datos privados importados: ${formatNumber(likeProfiles)} perfiles con likes y ${formatNumber(data.specials.length)} clasificaciones.`);
    } catch (err) {
      console.error(err);
      toast('Ese archivo no es un paquete privado válido.');
    }
  }

  async function exportBackup() {
    const backup = {
      app: 'InstaFollower', version: 1, exportedAt: new Date().toISOString(),
      snapshots: state.snapshots,
      currentSnapshotId: state.currentSnapshot?.id || null,
      classifications: state.classifications,
      likes: state.likes,
      likeImports: state.likeImports,
      settings: state.settings,
    };
    const text = JSON.stringify(backup, null, 2);
    const filename = `InstaFollower_backup_${new Date().toISOString().slice(0,10)}.json`;
    if (window.AndroidBridge?.saveTextFile) {
      try { window.AndroidBridge.saveTextFile(filename, text); toast('Elige dónde guardar el respaldo'); return; }
      catch (err) { console.warn('AndroidBridge.saveTextFile:', err); }
    }
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('Respaldo exportado');
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data?.app !== 'InstaFollower' || !Array.isArray(data.snapshots)) throw new Error('Formato no reconocido');
      state.snapshots = data.snapshots || [];
      state.classifications = data.classifications || {};
      state.likes = data.likes || {};
      state.likeImports = data.likeImports || [];
      state.settings = { openMode: 'intent', ...(data.settings || {}) };
      const currentId = data.currentSnapshotId;
      state.currentSnapshot = state.snapshots.find(s => s.id === currentId) || state.snapshots.at(-1) || null;
      await Promise.all([
        dbSet('snapshots', state.snapshots), dbSet('currentSnapshotId', state.currentSnapshot?.id || null),
        dbSet('classifications', state.classifications), dbSet('likes', state.likes),
        dbSet('likeImports', state.likeImports), dbSet('settings', state.settings),
      ]);
      state.lastComparison = state.snapshots.length > 1 ? compareSnapshots(state.snapshots.at(-2), state.snapshots.at(-1)) : null;
      renderAll();
      toast('Respaldo restaurado');
    } catch (err) {
      console.error(err);
      toast('Ese archivo no es un respaldo válido.');
    }
  }

  function switchTab(target) {
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.tab === target));
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.target === target));
    window.scrollTo(0, 0);
  }

  function bindEvents() {
    $$('.nav-item').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.target)));
    $('#zipInput').addEventListener('change', e => { importZip(e.target.files[0]); e.target.value = ''; });
    $('#zipInputSettings').addEventListener('change', e => { importZip(e.target.files[0]); e.target.value = ''; });
    $('#csvInput').addEventListener('change', e => { importCSV(e.target.files[0]); e.target.value = ''; });
    $('#importBackupInput').addEventListener('change', e => { importBackup(e.target.files[0]); e.target.value = ''; });
    $('#privateDataInput').addEventListener('change', e => { importPrivateData(e.target.files[0]); e.target.value = ''; });

    $('#profileSearch').addEventListener('input', e => {
      state.profileSearch = e.target.value;
      $('#clearSearch').classList.toggle('hidden', !state.profileSearch);
      renderFollowers();
    });
    $('#clearSearch').addEventListener('click', () => {
      state.profileSearch = '';
      $('#profileSearch').value = '';
      $('#clearSearch').classList.add('hidden');
      renderFollowers();
    });
    $('#likesSearch').addEventListener('input', e => { state.likesSearch = e.target.value; renderLikes(); });

    $('#filterChips').addEventListener('click', e => {
      const btn = e.target.closest('[data-filter]');
      if (!btn) return;
      state.filter = btn.dataset.filter;
      $$('#filterChips .chip').forEach(x => x.classList.toggle('active', x === btn));
      renderFollowers();
    });

    $('#sortBtn').addEventListener('click', () => {
      state.sort = state.sort === 'username' ? 'likes' : 'username';
      renderFollowers();
    });

    async function cardClickHandler(e) {
      const tag = e.target.closest('[data-tag-user]');
      if (tag) { e.stopPropagation(); await toggleSpecial(tag.dataset.tagUser); return; }
      const block = e.target.closest('[data-block-user]');
      if (block) { e.stopPropagation(); await toggleBlocked(block.dataset.blockUser); return; }
      const open = e.target.closest('[data-open-user]');
      if (open) { e.stopPropagation(); openInstagram(open.dataset.openUser); return; }
      const card = e.target.closest('.profile-card[data-user]');
      if (card) openInstagram(card.dataset.user);
    }
    $('#profileList').addEventListener('click', cardClickHandler);
    $('#likesList').addEventListener('click', cardClickHandler);
    $('#changesContent').addEventListener('click', e => {
      const open = e.target.closest('[data-open-user]');
      if (open) { e.stopPropagation(); openInstagram(open.dataset.openUser); return; }
      const card = e.target.closest('.change-user[data-user]');
      if (card) openInstagram(card.dataset.user);
    });

    $('#profileList').addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.profile-card')) {
        e.preventDefault(); openInstagram(e.target.dataset.user);
      }
    });

    $('#addLikesTextBtn').addEventListener('click', async () => {
      const text = $('#likesText').value;
      const records = likesFromText(text);
      const fp = await sha256Hex(`text\n${text.trim()}`);
      await addLikes(records, 'Entrada de texto', fp);
      if (records.length) $('#likesText').value = '';
    });

    $('#openModeControl').addEventListener('click', async e => {
      const btn = e.target.closest('[data-mode]');
      if (!btn) return;
      state.settings.openMode = btn.dataset.mode;
      await dbSet('settings', state.settings);
      renderSettings();
    });

    $('#exportBackupBtn').addEventListener('click', exportBackup);
    $('#clearLikesBtn').addEventListener('click', () => openModal(`
      <h2>Borrar likes</h2><p>Se eliminarán todos los contadores e importaciones de likes. Los snapshots y clasificaciones se conservarán.</p>
      <div class="modal-actions"><button id="confirmClearLikes" class="danger-btn wide" type="button">Sí, borrar likes</button><button class="secondary-btn wide" data-close-modal type="button">Cancelar</button></div>
    `));
    $('#clearAllBtn').addEventListener('click', () => openModal(`
      <h2>Borrar todos los datos</h2><p>Se eliminarán historial, snapshots, likes, clasificaciones y ajustes guardados en este origen.</p>
      <div class="modal-actions"><button id="confirmClearAll" class="danger-btn wide" type="button">Sí, borrar todo</button><button class="secondary-btn wide" data-close-modal type="button">Cancelar</button></div>
    `));

    $('#modalClose').addEventListener('click', closeModal);
    $('#modalBackdrop').addEventListener('click', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
    $('#modalBody').addEventListener('click', async e => {
      if (e.target.closest('[data-close-modal]')) closeModal();
      if (e.target.id === 'confirmClearLikes') {
        state.likes = {}; state.likeImports = [];
        await Promise.all([dbSet('likes', {}), dbSet('likeImports', [])]);
        closeModal(); renderAll(); toast('Likes borrados');
      }
      if (e.target.id === 'confirmClearAll') {
        await dbClear();
        state.snapshots = []; state.currentSnapshot = null; state.classifications = {}; state.likes = {}; state.likeImports = []; state.lastComparison = null; state.settings = { openMode: 'intent' };
        closeModal(); renderAll(); toast('Datos borrados');
      }
    });

    $('#installBtn').addEventListener('click', async () => {
      if (!state.deferredInstallPrompt) { renderInstallHelp(); toast('Usa el menú del navegador para instalarla.'); return; }
      state.deferredInstallPrompt.prompt();
      await state.deferredInstallPrompt.userChoice;
      state.deferredInstallPrompt = null;
      $('#installBtn').classList.add('hidden');
    });

    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      state.deferredInstallPrompt = e;
      $('#installBtn').classList.remove('hidden');
    });
    window.addEventListener('appinstalled', () => {
      state.deferredInstallPrompt = null;
      $('#installBtn').classList.add('hidden');
      renderInstallHelp();
      toast('InstaFollower instalada');
    });

    window.addEventListener('pageshow', e => {
      if (e.persisted) renderAll();
    });

    const io = new IntersectionObserver(entries => {
      if (!entries.some(x => x.isIntersecting)) return;
      if (state.renderLimit < state.filteredProfiles.length) {
        state.renderLimit += PAGE_SIZE;
        renderProfileChunk(false);
      }
    }, { rootMargin: '400px 0px' });
    io.observe($('#listSentinel'));
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!['http:', 'https:'].includes(location.protocol)) return;
    try { await navigator.serviceWorker.register('./sw.js'); }
    catch (err) { console.warn('Service Worker:', err); }
  }

  async function init() {
    try {
      state.db = await openDB();
      await loadState();
      if (state.snapshots.length > 1) state.lastComparison = compareSnapshots(state.snapshots.at(-2), state.snapshots.at(-1));
      bindEvents();
      renderAll();
      registerServiceWorker();
    } catch (err) {
      console.error(err);
      document.body.innerHTML = `<main style="padding:24px;color:white;font-family:system-ui"><h2>No se pudo iniciar InstaFollower</h2><p>${escapeHTML(err.message || String(err))}</p></main>`;
    }
  }

  init();
})();
