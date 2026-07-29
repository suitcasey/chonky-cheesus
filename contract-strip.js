/**
 * Renders CA / chart / buy strip from window.CHONKY_CONFIG
 */
(function (global) {
  'use strict';

  function cfg() {
    return global.CHONKY_CONFIG || {};
  }

  function shortCa(ca) {
    if (!ca || ca.length < 12) return ca || '';
    return ca.slice(0, 4) + '…' + ca.slice(-4);
  }

  function renderContractStrip(rootId, opts) {
    opts = opts || {};
    const el = document.getElementById(rootId);
    if (!el) return;
    const c = cfg();
    const launched = !!(c.launched && c.ca);
    const compact = !!opts.compact;

    if (!launched) {
      el.innerHTML = `
        <div class="rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 ${compact ? 'text-left' : 'text-center'}">
          <div class="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1" style="font-family:IBM Plex Mono,monospace">Contract</div>
          <p class="text-xs text-zinc-500 leading-relaxed">
            CA not live yet. When $CHONK mints, the address appears here.
          </p>
          <a href="${c.xUrl || 'https://x.com/CHONKYCHEESUS'}" target="_blank" rel="noopener noreferrer"
             class="inline-flex items-center gap-1.5 mt-2 text-xs text-amber-400/90 hover:text-amber-300">
            Follow ${c.xHandle || '@CHONKYCHEESUS'} for Genesis
          </a>
        </div>`;
      return;
    }

    const buy = c.buyUrl || c.chartUrl || '#';
    const chart = c.chartUrl || c.buyUrl || '#';
    el.innerHTML = `
      <div class="rounded-2xl border border-amber-500/25 bg-zinc-900/70 px-4 py-3">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div class="text-[10px] uppercase tracking-[0.2em] text-amber-500/90" style="font-family:IBM Plex Mono,monospace">
            ${c.ticker || '$CHONK'} · live
          </div>
          <a href="${c.xUrl || 'https://x.com/CHONKYCHEESUS'}" target="_blank" rel="noopener noreferrer"
             class="text-xs text-zinc-400 hover:text-amber-300">X ${c.xHandle || ''}</a>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <code class="flex-1 min-w-0 truncate rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[11px] text-amber-100/90" title="${c.ca}">${c.ca}</code>
          <button type="button" data-copy-ca class="shrink-0 rounded-xl bg-amber-400 px-3 py-2 text-xs font-bold text-zinc-950 hover:bg-amber-300">Copy CA</button>
        </div>
        <div class="mt-2 flex flex-wrap gap-2">
          <a href="${buy}" target="_blank" rel="noopener noreferrer"
             class="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-400/20">Buy</a>
          <a href="${chart}" target="_blank" rel="noopener noreferrer"
             class="rounded-xl border border-zinc-600 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800">Chart</a>
          ${c.ritualWallet ? `<span class="text-[10px] text-zinc-600 font-mono self-center">Ritual: ${shortCa(c.ritualWallet)}</span>` : ''}
        </div>
        <p class="mt-2 text-[10px] text-zinc-600 leading-snug">CA is the costume. The Stay is the product.</p>
      </div>`;

    const btn = el.querySelector('[data-copy-ca]');
    if (btn) {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(c.ca);
          btn.textContent = 'Copied';
          setTimeout(() => { btn.textContent = 'Copy CA'; }, 1500);
        } catch {
          prompt('Copy CA:', c.ca);
        }
      });
    }
  }

  global.ChonkyContract = { renderContractStrip, cfg };
})(window);
