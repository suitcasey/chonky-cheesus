/**
 * Chonky Cheesus — Phase 2 public flex
 * Canon Wall, Saints roster, title claim, share relic.
 * Requires the cult server (python3 server.py) for multi-user writes.
 */
(function (global) {
  'use strict';

  const CLIENT_ID_KEY = 'chonky_client_id';
  const CLAIMED_KEY = 'chonky_public_claim';

  function getClientId() {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  }

  function apiBase() {
    // Same origin when served by server.py; empty when file://
    if (location.protocol === 'file:') return 'http://127.0.0.1:8787';
    return '';
  }

  function isHostedPublic() {
    const h = (location.hostname || '').toLowerCase();
    if (!h || h === 'localhost' || h === '127.0.0.1') return false;
    return true;
  }

  function publicSiteUrl() {
    // Share the Witness shell (simple entry); Sanctum is opt-in
    if (location.protocol === 'file:') {
      return 'https://chonky-cheesus.onrender.com/';
    }
    const origin = location.origin || 'https://chonky-cheesus.onrender.com';
    return origin.replace(/\/$/, '') + '/';
  }

  async function api(path, options = {}) {
    const url = apiBase() + path;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const err = new Error((body && body.error) || res.statusText || 'request_failed');
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  const PublicCult = {
    online: false,
    waking: false,
    whispers: [],
    saints: [],
    amplifiesLeft: 7,
    lastError: null,
    world: null,

    async probe() {
      try {
        const h = await api('/api/health');
        this.online = !!(h && h.ok);
        this.waking = false;
        this.lastError = null;
        if (h && h.world) this.world = h.world;
      } catch (e) {
        this.online = false;
        this.lastError = e.message;
      }
      return this.online;
    },

    async refreshWorld() {
      const data = await api('/api/world');
      this.world = data.world || null;
      return this.world;
    },

    async postBelief(kind) {
      const data = await api('/api/belief', {
        method: 'POST',
        body: JSON.stringify({ kind, clientId: getClientId() }),
      });
      if (data.world) this.world = data.world;
      return data;
    },

    /** Retry health for free-tier cold starts (e.g. Render sleep). */
    async probeWithRetry({ attempts = 18, delayMs = 4000, onAttempt } = {}) {
      this.waking = !this.online && isHostedPublic();
      for (let i = 0; i < attempts; i++) {
        if (typeof onAttempt === 'function') onAttempt(i + 1, attempts);
        const ok = await this.probe();
        if (ok) {
          this.waking = false;
          return true;
        }
        this.waking = isHostedPublic();
        if (i < attempts - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      this.waking = false;
      return false;
    },

    async refreshWhispers() {
      const data = await api('/api/whispers');
      this.whispers = data.whispers || [];
      return this.whispers;
    },

    async refreshSaints() {
      const data = await api('/api/saints');
      this.saints = data.saints || [];
      return this.saints;
    },

    async postWhisper({ message, username, fragments }) {
      const data = await api('/api/whispers', {
        method: 'POST',
        body: JSON.stringify({
          message,
          username,
          fragments,
          clientId: getClientId(),
        }),
      });
      if (data.world) this.world = data.world;
      return data;
    },

    async amplify(id) {
      const data = await api(`/api/whispers/${encodeURIComponent(id)}/amplify`, {
        method: 'POST',
        body: JSON.stringify({ clientId: getClientId() }),
      });
      if (typeof data.amplifiesLeft === 'number') this.amplifiesLeft = data.amplifiesLeft;
      if (data.world) this.world = data.world;
      return data;
    },

    async claimTitle({ name, rank, fragments, sanctum, forbidden, thickness, streak, ritesCompleted }) {
      const data = await api('/api/saints', {
        method: 'POST',
        body: JSON.stringify({
          name,
          rank,
          fragments,
          sanctum,
          forbidden,
          thickness: thickness || 0,
          streak: streak || 0,
          ritesCompleted: ritesCompleted || 0,
          clientId: getClientId(),
        }),
      });
      if (data.saint) {
        localStorage.setItem(CLAIMED_KEY, JSON.stringify(data.saint));
      }
      if (data.world) this.world = data.world;
      return data;
    },

    getLocalClaim() {
      try {
        const raw = localStorage.getItem(CLAIMED_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
  };

  // ---------- Relic card (canvas) ----------
  function drawRelicCard({ name, rank, fragments, sanctum, forbidden, score, streak }) {
    const w = 720;
    const h = 900;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // Background
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#18181b');
    grad.addColorStop(0.45, '#09090b');
    grad.addColorStop(1, '#1c1410');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Amber glow orb
    const orb = ctx.createRadialGradient(w * 0.5, h * 0.28, 20, w * 0.5, h * 0.28, 220);
    orb.addColorStop(0, 'rgba(245, 158, 11, 0.45)');
    orb.addColorStop(1, 'rgba(245, 158, 11, 0)');
    ctx.fillStyle = orb;
    ctx.fillRect(0, 0, w, h);

    // Border
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
    ctx.lineWidth = 4;
    roundRect(ctx, 28, 28, w - 56, h - 56, 36);
    ctx.stroke();

    // Inner hairline
    ctx.strokeStyle = 'rgba(252, 211, 77, 0.2)';
    ctx.lineWidth = 1;
    roundRect(ctx, 44, 44, w - 88, h - 88, 28);
    ctx.stroke();

    // Label
    ctx.fillStyle = '#f59e0b';
    ctx.font = '600 18px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CHONKY CHEESUS  ·  RELIC', w / 2, 100);

    // Rank
    ctx.fillStyle = '#fef3c7';
    ctx.font = '800 64px Inter, system-ui, sans-serif';
    ctx.fillText(String(rank || 'Degen').toUpperCase(), w / 2, 190);

    // Cheese circle
    const cx = w / 2;
    const cy = 340;
    const r = 110;
    const cheeseGrad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    cheeseGrad.addColorStop(0, '#fde047');
    cheeseGrad.addColorStop(0.5, '#facc15');
    cheeseGrad.addColorStop(1, '#d97706');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = cheeseGrad;
    ctx.fill();
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#b45309';
    ctx.stroke();

    ctx.fillStyle = '#78350f';
    ctx.font = '900 36px Inter, system-ui, sans-serif';
    ctx.fillText('CHONK', cx, cy + 12);

    // Name
    ctx.fillStyle = '#fafafa';
    ctx.font = '700 40px Inter, system-ui, sans-serif';
    ctx.fillText(truncate(name || 'Anonymous Degen', 22), w / 2, 520);

    // Stats
    ctx.fillStyle = '#a1a1aa';
    ctx.font = '500 20px Inter, system-ui, sans-serif';
    const stats = [
      `Fragments  ${fragments || 0}/7`,
      `Sanctum    ${sanctum ? 'TRANSCENDED' : '—'}`,
      `Forbidden  ${forbidden ? 'KNOWN' : '—'}`,
      `Thickness  ${score != null ? score : '—'}`,
      `Streak     ${streak != null ? streak + 'd' : '—'}`,
    ];
    stats.forEach((line, i) => {
      ctx.fillText(line, w / 2, 560 + i * 32);
    });

    // Footer doctrine
    ctx.fillStyle = '#f59e0b';
    ctx.font = '600 18px Inter, system-ui, sans-serif';
    ctx.fillText('Never meant to make sense.', w / 2, 780);
    ctx.fillStyle = '#71717a';
    ctx.font = '500 16px Inter, system-ui, sans-serif';
    ctx.fillText('Meant to make you stay.  ·  $CHONK', w / 2, 812);

    return canvas;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function truncate(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function downloadCanvas(canvas, filename) {
    const a = document.createElement('a');
    a.download = filename || 'chonky-relic.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  }

  function shareCaption({ name, rank }) {
    const link = publicSiteUrl();
    return (
      `I am ${rank} in the cult of Chonky Cheesus.\n` +
      `Name: ${name || 'Anonymous Degen'}\n` +
      `Never meant to make sense. Meant to make you stay.\n` +
      `${link}\n` +
      `#CHONK #ChonkyCheesus`
    );
  }

  global.ChonkyPublic = {
    PublicCult,
    getClientId,
    drawRelicCard,
    downloadCanvas,
    shareCaption,
    apiBase,
    isHostedPublic,
    publicSiteUrl,
  };
})(window);
