/**
 * Shared keeper state: daily rites, name, rank helpers.
 */
(function (global) {
  'use strict';

  const KEYS = {
    RITE: 'chonky_daily_rite',
    THICKNESS: 'chonky_thickness',
    USERNAME: 'chonky_username',
    LORE: 'chonky_lore_discovered',
    SANCTUM: 'sanctum_completed',
    FORBIDDEN: 'chonky_forbidden_unlocked',
    CLAIMED: 'chonky_public_claim',
  };

  const RITE_TYPES = [
    { id: 'bites', title: 'The Nibble', desc: 'Bite the cheese. Presence is mass.', target: 12, action: 'bites', hint: 'On the main page — click the cheese wheel.', where: 'main' },
    { id: 'copium', title: 'The Sacrament', desc: 'Recite the sacred copium.', target: 1, action: 'copium', hint: 'On the main page — hit Copium.', where: 'main' },
    { id: 'confess', title: 'The Seal', desc: 'Seal one private confession (Believer+).', target: 1, action: 'confess', hint: 'On the main page — confessional after 7 fragments.', where: 'main' },
    { id: 'send_it', title: 'The YOLO', desc: 'SEND IT once. Degens pray out loud.', target: 1, action: 'send_it', hint: 'On the main page — hit SEND IT.', where: 'main' },
    { id: 'amplify_public', title: 'The Witness', desc: 'Amplify once on the Living Wall.', target: 1, action: 'amplify_public', hint: 'On the main page — Public Wall → Amplify.', where: 'main' },
  ];

  const RANKS = [
    { id: 'degen', label: 'Degen', minFragments: 0, requiresSanctum: false, requiresForbidden: false },
    { id: 'initiate', label: 'Initiate', minFragments: 3, requiresSanctum: false, requiresForbidden: false },
    { id: 'believer', label: 'Believer', minFragments: 7, requiresSanctum: false, requiresForbidden: false },
    { id: 'disciple', label: 'Disciple', minFragments: 7, requiresSanctum: true, requiresForbidden: false },
    { id: 'saint', label: 'Saint', minFragments: 7, requiresSanctum: true, requiresForbidden: true },
  ];

  const RESERVED = new Set([
    'chonky', 'cheesus', 'chonkycheesus', 'chonk',
    'thinones', 'thethinones', 'thinone', 'thethinone',
    'falseprophet', 'thefalseprophets', 'keeper', 'thekeeper', 'sanctum',
  ]);

  let riteState = null;
  let onCompleteHook = null;

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function yesterdayKey() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function dayIndex(dateStr) {
    const [y, m, day] = dateStr.split('-').map(Number);
    const start = new Date(y, 0, 0);
    const now = new Date(y, m - 1, day);
    return Math.floor((now - start) / 86400000);
  }

  function loadRiteState() {
    const today = todayKey();
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(KEYS.RITE) || 'null');
    } catch {
      raw = null;
    }

    if (raw && raw.day === today) {
      riteState = raw;
      return riteState;
    }

    const type = RITE_TYPES[dayIndex(today) % RITE_TYPES.length];
    const totalRites = (raw && raw.totalRites) || 0;
    const lastCompletedDay = (raw && raw.lastCompletedDay) || null;
    let streak = 0;
    if (lastCompletedDay === yesterdayKey() || lastCompletedDay === today) {
      streak = (raw && raw.streak) || 0;
    }

    riteState = {
      day: today,
      typeId: type.id,
      progress: 0,
      completed: false,
      streak,
      lastCompletedDay,
      totalRites,
    };
    saveRiteState();
    return riteState;
  }

  function saveRiteState() {
    if (riteState) localStorage.setItem(KEYS.RITE, JSON.stringify(riteState));
  }

  function getRiteState() {
    if (!riteState) loadRiteState();
    return riteState;
  }

  function currentRiteType() {
    if (!riteState) loadRiteState();
    return RITE_TYPES.find((t) => t.id === riteState.typeId) || RITE_TYPES[0];
  }

  function completeRite() {
    if (!riteState || riteState.completed) return riteState;
    const today = todayKey();
    const yday = yesterdayKey();

    if (riteState.lastCompletedDay === yday) {
      riteState.streak = (riteState.streak || 0) + 1;
    } else if (riteState.lastCompletedDay !== today) {
      riteState.streak = 1;
    }

    riteState.completed = true;
    riteState.progress = currentRiteType().target;
    riteState.lastCompletedDay = today;
    riteState.totalRites = (riteState.totalRites || 0) + 1;
    saveRiteState();
    if (typeof onCompleteHook === 'function') onCompleteHook(riteState, currentRiteType());
    return riteState;
  }

  function trackRite(action, amount) {
    amount = amount == null ? 1 : amount;
    if (!riteState) loadRiteState();
    if (riteState.completed) return { state: riteState, completed: false };
    const type = currentRiteType();
    if (type.action !== action) return { state: riteState, completed: false };

    riteState.progress = Math.min(type.target, (riteState.progress || 0) + amount);
    if (riteState.progress >= type.target) {
      completeRite();
      return { state: riteState, completed: true };
    }
    saveRiteState();
    return { state: riteState, completed: false };
  }

  function setOnRiteComplete(fn) {
    onCompleteHook = fn;
  }

  function discoveredCount() {
    try {
      const saved = localStorage.getItem(KEYS.LORE);
      if (!saved) return 0;
      return JSON.parse(saved).length;
    } catch {
      return 0;
    }
  }

  function isSanctumComplete() {
    return localStorage.getItem(KEYS.SANCTUM) === 'true';
  }

  function isForbiddenUnlocked() {
    return localStorage.getItem(KEYS.FORBIDDEN) === 'true';
  }

  function deriveRank() {
    const count = discoveredCount();
    const sanctum = isSanctumComplete();
    const forbidden = isForbiddenUnlocked();
    let rank = RANKS[0];
    for (const r of RANKS) {
      if (count >= r.minFragments && (!r.requiresSanctum || sanctum) && (!r.requiresForbidden || forbidden)) {
        rank = r;
      }
    }
    return rank;
  }

  function getThickness() {
    return parseInt(localStorage.getItem(KEYS.THICKNESS) || '0', 10) || 0;
  }

  function setThickness(n) {
    localStorage.setItem(KEYS.THICKNESS, String(n));
  }

  function getUsername() {
    return localStorage.getItem(KEYS.USERNAME) || '';
  }

  function normalizeNameKey(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  function isReservedName(name) {
    return RESERVED.has(normalizeNameKey(name));
  }

  function setUsername(name) {
    const trimmed = String(name || '').trim() || 'Degen';
    if (isReservedName(trimmed)) {
      return { ok: false, error: 'reserved' };
    }
    localStorage.setItem(KEYS.USERNAME, trimmed);
    return { ok: true, name: trimmed };
  }

  function getLocalClaim() {
    try {
      const raw = localStorage.getItem(KEYS.CLAIMED);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function riteSummary() {
    loadRiteState();
    const type = currentRiteType();
    const progress = riteState.completed ? type.target : Math.min(riteState.progress || 0, type.target);
    return {
      type,
      state: riteState,
      progress,
      pct: Math.min(100, Math.round((progress / type.target) * 100)),
      done: !!riteState.completed,
    };
  }

  global.ChonkyKeeper = {
    KEYS,
    RITE_TYPES,
    RANKS,
    loadRiteState,
    saveRiteState,
    getRiteState,
    currentRiteType,
    trackRite,
    completeRite,
    setOnRiteComplete,
    deriveRank,
    discoveredCount,
    isSanctumComplete,
    isForbiddenUnlocked,
    getThickness,
    setThickness,
    getUsername,
    setUsername,
    isReservedName,
    normalizeNameKey,
    getLocalClaim,
    riteSummary,
    todayKey,
    yesterdayKey,
  };
})(window);
