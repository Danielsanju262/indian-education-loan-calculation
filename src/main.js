import { runSimulation, formatCurrency, formatCurrencyExact, formatMonthYear } from './loanEngine.js';
import { supabase } from './supabase.js';

/* ═══════════════════════════════════════════
   ANONYMOUS USER TOKEN
   Each browser gets a UUID on first visit — no login required.
   ═══════════════════════════════════════════ */
function getUserToken() {
  let token = localStorage.getItem('loanlens_user_token');
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem('loanlens_user_token', token);
  }
  return token;
}

/* ═══════════════════════════════════════════
   HISTORY — SAVE
   ═══════════════════════════════════════════ */
async function saveCalculation(name, params, summary) {
  const userToken = getUserToken();
  const { error } = await supabase.from('loan_calculations').insert({
    user_token: userToken,
    name: name.trim(),
    params: params,
    summary: {
      emi: summary.emi,
      grandTotal: summary.grandTotal,
      totalInterestOverall: summary.totalInterestOverall,
      totalDisbursed: summary.totalDisbursed,
      moratoriumMonths: summary.moratoriumMonths,
      tenureMonths: summary.tenureMonths,
      annualRate: summary.annualRate,
      emiStartDate: summary.emiStartDate,
      emiEndDate: summary.emiEndDate,
    },
  });
  return error;
}

/* ═══════════════════════════════════════════
   HISTORY — LOAD LIST
   ═══════════════════════════════════════════ */
async function fetchHistory() {
  const userToken = getUserToken();
  const { data, error } = await supabase
    .from('loan_calculations')
    .select('id, name, summary, params, created_at')
    .eq('user_token', userToken)
    .order('created_at', { ascending: false });
  return { data, error };
}

/* ═══════════════════════════════════════════
   HISTORY — DELETE
   ═══════════════════════════════════════════ */
async function deleteCalculation(id) {
  const { error } = await supabase.from('loan_calculations').delete().eq('id', id);
  return error;
}

/* ═══════════════════════════════════════════
   HISTORY DRAWER — RENDER
   ═══════════════════════════════════════════ */
function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function openHistoryDrawer() {
  const overlay = document.getElementById('history-overlay');
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  const listEl = document.getElementById('history-list');
  const emptyEl = document.getElementById('history-empty');
  listEl.innerHTML = '<div class="history-loading">Loading…</div>';

  const { data, error } = await fetchHistory();
  if (error || !data) {
    listEl.innerHTML = '<div class="history-loading" style="color:var(--red)">Failed to load history. Check your connection.</div>';
    return;
  }
  if (data.length === 0) {
    listEl.innerHTML = '';
    listEl.appendChild(emptyEl);
    emptyEl.style.display = 'flex';
    return;
  }

  listEl.innerHTML = data.map(item => `
    <div class="history-item" data-id="${item.id}">
      <div class="hi-main">
        <div class="hi-name">${item.name}</div>
        <div class="hi-date">${formatDate(item.created_at)}</div>
        <div class="hi-metrics">
          <span class="hi-metric"><span class="hi-m-label">EMI</span> <strong>${formatCurrency(item.summary.emi)}</strong></span>
          <span class="hi-metric"><span class="hi-m-label">Total</span> <strong>${formatCurrency(item.summary.grandTotal)}</strong></span>
          <span class="hi-metric"><span class="hi-m-label">Rate</span> <strong>${item.summary.annualRate}%</strong></span>
          <span class="hi-metric"><span class="hi-m-label">Tenure</span> <strong>${item.summary.tenureMonths}mo</strong></span>
        </div>
      </div>
      <div class="hi-actions">
        <button class="btn-hi-load" data-id="${item.id}">Load →</button>
        <button class="btn-hi-delete" data-id="${item.id}" title="Delete">🗑</button>
      </div>
    </div>
  `).join('');

  // Attach events
  listEl.querySelectorAll('.btn-hi-load').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = data.find(d => d.id === btn.dataset.id);
      if (item) loadFromHistory(item);
    });
  });
  listEl.querySelectorAll('.btn-hi-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.history-item');
      btn.textContent = '…';
      btn.disabled = true;
      const err = await deleteCalculation(btn.dataset.id);
      if (!err) {
        row.style.animation = 'fadeOut 0.25s forwards';
        setTimeout(() => { row.remove(); if (!listEl.querySelector('.history-item')) openHistoryDrawer(); }, 260);
      } else {
        btn.textContent = '🗑';
        btn.disabled = false;
      }
    });
  });
}

function closeHistoryDrawer() {
  document.getElementById('history-overlay').style.display = 'none';
  document.body.style.overflow = '';
}

/* ═══════════════════════════════════════════
   POPULATE FORM FROM SAVED PARAMS
   ═══════════════════════════════════════════ */
function populateFormData(params) {
  document.getElementById('sanctioned-amount').value = params.sanctionedAmount || '';
  document.getElementById('interest-rate').value = params.annualRate || '';
  document.getElementById('tenure').value = params.tenureMonths || '';

  // Moratorium — strip the '-01' suffix
  if (params.moratoriumStart)
    document.getElementById('moratorium-start').value = params.moratoriumStart.substring(0, 7);
  if (params.moratoriumEnd)
    document.getElementById('moratorium-end').value = params.moratoriumEnd.substring(0, 7);

  // SI option
  const siType = params.siOption?.type || 'none';
  const radio = document.querySelector(`input[name="si-type"][value="${siType}"]`);
  if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }
  if (siType === 'custom' && params.siOption?.customAmount)
    document.getElementById('si-custom-amount').value = params.siOption.customAmount;

  // Clear existing disbursement/prepayment rows
  document.querySelectorAll('.disbursement-row').forEach(r => r.remove());
  disbCounter = 0;
  updateDisbEmptyState();
  updateLimitBar();

  document.querySelectorAll('.prepayment-row').forEach(r => r.remove());
  prepCounter = 0;
  updatePrepEmptyState();

  // Re-create disbursement rows
  (params.disbursements || []).forEach(d => {
    createDisbursementRow();
    const id = disbCounter;
    const dateEl = document.getElementById(`disb-date-${id}`);
    const amtEl = document.getElementById(`disb-amount-${id}`);
    if (dateEl) dateEl.value = d.date ? d.date.substring(0, 7) : '';
    if (amtEl) { amtEl.value = d.amount || ''; amtEl.dispatchEvent(new Event('input')); }
  });

  // Re-create prepayment rows
  (params.prePayments || []).forEach(p => {
    createPrepaymentRow();
    const id = prepCounter;
    const dateEl = document.getElementById(`prep-date-${id}`);
    const amtEl = document.getElementById(`prep-amount-${id}`);
    if (dateEl) dateEl.value = p.date ? p.date.substring(0, 7) : '';
    if (amtEl) { amtEl.value = p.amount || ''; amtEl.dispatchEvent(new Event('input')); }
  });

  // Trigger live hints
  updateLiveHints();
  updateLimitBar();
}

/* ═══════════════════════════════════════════
   LOAD FROM HISTORY
   ═══════════════════════════════════════════ */
function loadFromHistory(item) {
  closeHistoryDrawer();
  populateFormData(item.params);

  // Re-run simulation immediately and go to results
  const params = item.params;
  const result = runSimulation(params);
  if (result.error) { showError(result.error); showStep(1); return; }

  lastSimParams = params;
  lastSimResult = result;
  renderResults(result);
  showStep(4);

  // Pre-fill the save card name so user knows which calc is loaded
  const nameEl = document.getElementById('save-calc-name');
  if (nameEl) nameEl.placeholder = `Update: ${item.name}`;

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}


/* ═══════════════════════════════════════════
   INDIAN NUMBER FORMATTING UTILITIES
   ═══════════════════════════════════════════ */

/** Format a number in Indian comma system: 12345678 → "1,23,45,678" */
function toIndianFormat(num) {
  if (num === null || num === undefined || num === '') return '';
  const n = Math.abs(Math.floor(num));
  const str = n.toString();
  if (str.length <= 3) return str;

  // Last 3 digits form the first group (ones/tens/hundreds)
  const last3 = str.slice(-3);
  let rest = str.slice(0, str.length - 3);

  // Now split 'rest' into groups of 2 scanning from RIGHT to LEFT
  const groups = [];
  while (rest.length > 0) {
    groups.unshift(rest.slice(-2));  // take last 2 chars
    rest = rest.slice(0, -2);        // remove them
  }

  return groups.join(',') + ',' + last3;
}

/** Convert a number to Indian words (up to crores) */
function toIndianWords(num) {
  if (!num || isNaN(num)) return '';
  num = Math.floor(Math.abs(num));
  if (num === 0) return 'Zero';

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function belowHundred(n) {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  }

  function belowThousand(n) {
    if (n < 100) return belowHundred(n);
    return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + belowHundred(n % 100) : '');
  }

  const parts = [];
  const crore = Math.floor(num / 10000000);
  num %= 10000000;
  const lakh = Math.floor(num / 100000);
  num %= 100000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;
  const rest = num;

  if (crore) parts.push(belowThousand(crore) + ' Crore');
  if (lakh) parts.push(belowHundred(lakh) + ' Lakh');
  if (thousand) parts.push(belowHundred(thousand) + ' Thousand');
  if (rest) parts.push(belowThousand(rest));

  return parts.join(' ');
}

/**
 * Attach live Indian formatting to a rupee input.
 * Shows formatted amount and words in an element below the input.
 */
function attachRupeeFormatter(inputEl, displayEl) {
  if (!inputEl || !displayEl) return;
  const update = () => {
    const val = parseFloat(inputEl.value);
    if (!val || val <= 0) {
      displayEl.textContent = '';
      displayEl.className = 'amount-words';
      return;
    }
    const formatted = toIndianFormat(val);
    const words = toIndianWords(val);
    displayEl.innerHTML = `<span class="aw-num">₹ ${formatted}</span> <span class="aw-sep">—</span> <span class="aw-words">${words} Rupees</span>`;
    displayEl.className = 'amount-words show';
  };
  inputEl.addEventListener('input', update);
  update();
}

/* ═══════════════════════════════════════════
   STEP WIZARD STATE
   ═══════════════════════════════════════════ */
let currentStep = 1;
const TOTAL_STEPS = 4;

function showStep(step) {
  // Hide all
  document.querySelectorAll('.step-section').forEach(s => {
    s.classList.remove('active');
    s.style.display = 'none';
  });

  const section = document.getElementById(`step-${step}`);
  if (section) {
    section.style.display = 'block';
    // Trigger animation re-play
    section.classList.remove('active');
    void section.offsetWidth; // reflow
    section.classList.add('active');
  }

  // Update nav pills
  document.querySelectorAll('.step-pill').forEach(pill => {
    const n = parseInt(pill.dataset.step);
    pill.classList.remove('active', 'completed');
    if (n === step) pill.classList.add('active');
    else if (n < step) pill.classList.add('completed');
  });

  // Update hero visibility
  const hero = document.getElementById('hero-section');
  if (hero) hero.style.display = step === 1 ? 'block' : 'none';

  currentStep = step;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ═══════════════════════════════════════════
   LIVE FIELD MATH HINTS
   ═══════════════════════════════════════════ */
function updateLiveHints() {
  const rate = parseFloat(document.getElementById('interest-rate').value);
  const tenure = parseInt(document.getElementById('tenure').value);

  const rateDisp = document.getElementById('monthly-rate-display');
  if (rateDisp) {
    if (rate > 0) {
      const monthly = (rate / 12).toFixed(4);
      rateDisp.textContent = `Monthly rate: ${monthly}% — ₹1L accrues ₹${(1000000 * rate / 100 / 12).toFixed(0)} interest/month`;
      rateDisp.className = 'field-math visible';
    } else {
      rateDisp.textContent = '';
      rateDisp.className = 'field-math';
    }
  }

  const tenureDisp = document.getElementById('tenure-years-display');
  if (tenureDisp) {
    if (tenure > 0) {
      const yrs = Math.floor(tenure / 12);
      const mos = tenure % 12;
      tenureDisp.textContent = yrs > 0 && mos > 0
        ? `${yrs} years ${mos} months repayment`
        : yrs > 0 ? `${yrs} years repayment` : `${mos} months repayment`;
      tenureDisp.className = 'field-math visible';
    } else {
      tenureDisp.textContent = '';
      tenureDisp.className = 'field-math';
    }
  }

  updateMoratoriumHint();
}

function updateMoratoriumHint() {
  const start = document.getElementById('moratorium-start').value;
  const end = document.getElementById('moratorium-end').value;
  const hint = document.getElementById('moratorium-calc-hint');
  if (!hint) return;

  if (start && end) {
    const s = new Date(start + '-01');
    const e = new Date(end + '-01');
    const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
    if (months > 0) {
      hint.textContent = `✓ ${months} month moratorium — ${Math.floor(months / 12)} year(s) ${months % 12} month(s). EMI starts ${formatMonthYear(new Date(e.getFullYear(), e.getMonth() + 1, 1))}.`;
      hint.classList.add('show');
    } else if (months <= 0) {
      hint.textContent = '⚠ Moratorium end must be after start date.';
      hint.classList.add('show');
    }
  } else {
    hint.classList.remove('show');
  }
}

/* ═══════════════════════════════════════════
   DISBURSEMENTS
   ═══════════════════════════════════════════ */
let disbCounter = 0;
let prepCounter = 0;

function createDisbursementRow() {
  disbCounter++;
  const id = disbCounter;
  const list = document.getElementById('disbursements-list');
  const empty = document.getElementById('disbursement-empty');

  const row = document.createElement('div');
  row.className = 'disbursement-row';
  row.id = `disb-row-${id}`;
  row.innerHTML = `
    <div class="row-num">${id}</div>
    <div class="row-fields">
      <div class="row-field">
        <span class="row-label">Disbursement Date</span>
        <div class="row-input-wrap">
          <input type="month" class="row-input disb-date" id="disb-date-${id}" />
        </div>
      </div>
      <div class="row-field">
        <span class="row-label">Amount (₹)</span>
        <div class="row-input-wrap">
          <span class="row-prefix">₹</span>
          <input type="number" class="row-input disb-amount" id="disb-amount-${id}" placeholder="e.g. 5,00,000" min="0" step="5000" />
        </div>
        <div class="amount-words" id="disb-words-${id}"></div>
      </div>
    </div>
    <button class="btn-remove-row" title="Remove" data-id="${id}">✕</button>
  `;
  list.appendChild(row);

  // Attach formatter
  attachRupeeFormatter(
    document.getElementById(`disb-amount-${id}`),
    document.getElementById(`disb-words-${id}`)
  );

  // Remove button
  row.querySelector('.btn-remove-row').addEventListener('click', () => {
    row.remove();
    updateDisbEmptyState();
    updateLimitBar();
  });

  row.querySelector('.disb-amount').addEventListener('input', () => {
    updateLimitBar();
  });

  empty.style.display = 'none';
  updateLimitBar();
}

function createPrepaymentRow() {
  prepCounter++;
  const id = prepCounter;
  const list = document.getElementById('prepayments-list');
  const empty = document.getElementById('prepayment-empty');

  const row = document.createElement('div');
  row.className = 'prepayment-row';
  row.id = `prep-row-${id}`;
  row.innerHTML = `
    <div class="row-num">${id}</div>
    <div class="row-fields">
      <div class="row-field">
        <span class="row-label">Payment Date</span>
        <div class="row-input-wrap">
          <input type="month" class="row-input prep-date" id="prep-date-${id}" />
        </div>
      </div>
      <div class="row-field">
        <span class="row-label">Amount (₹)</span>
        <div class="row-input-wrap">
          <span class="row-prefix">₹</span>
          <input type="number" class="row-input prep-amount" id="prep-amount-${id}" placeholder="e.g. 50,000" min="0" step="5000" />
        </div>
        <div class="amount-words" id="prep-words-${id}"></div>
      </div>
    </div>
    <button class="btn-remove-row" title="Remove" data-id="${id}">✕</button>
  `;
  list.appendChild(row);

  attachRupeeFormatter(
    document.getElementById(`prep-amount-${id}`),
    document.getElementById(`prep-words-${id}`)
  );

  row.querySelector('.btn-remove-row').addEventListener('click', () => {
    row.remove();
    updatePrepEmptyState();
  });

  empty.style.display = 'none';
}

function updateDisbEmptyState() {
  const rows = document.querySelectorAll('.disbursement-row');
  document.getElementById('disbursement-empty').style.display = rows.length === 0 ? 'flex' : 'none';
}

function updatePrepEmptyState() {
  const rows = document.querySelectorAll('.prepayment-row');
  document.getElementById('prepayment-empty').style.display = rows.length === 0 ? 'flex' : 'none';
}

function getTotalDisbursed() {
  let total = 0;
  document.querySelectorAll('.disb-amount').forEach(el => {
    total += parseFloat(el.value) || 0;
  });
  return total;
}

function updateLimitBar() {
  const sanctioned = parseFloat(document.getElementById('sanctioned-amount').value) || 0;
  const disbursed = getTotalDisbursed();

  const fillEl = document.getElementById('limit-bar-fill');
  const disprEl = document.getElementById('disbursed-total-disp');
  const sanctEl = document.getElementById('sanctioned-disp');
  const remText = document.getElementById('limit-remaining-text');

  if (disprEl) disprEl.textContent = '₹' + toIndianFormat(disbursed);
  if (sanctEl) sanctEl.textContent = '₹' + toIndianFormat(sanctioned);

  if (sanctioned > 0) {
    const pct = Math.min((disbursed / sanctioned) * 100, 100);
    if (fillEl) {
      fillEl.style.width = pct + '%';
      fillEl.classList.toggle('over', disbursed > sanctioned);
    }
    const remaining = sanctioned - disbursed;
    if (remText) {
      if (disbursed > sanctioned) {
        remText.textContent = `⚠ Exceeds sanctioned by ₹${toIndianFormat(disbursed - sanctioned)}`;
        remText.style.color = 'var(--red)';
      } else if (remaining === 0) {
        remText.textContent = '✓ Fully disbursed';
        remText.style.color = 'var(--green)';
      } else {
        remText.textContent = `₹${toIndianFormat(remaining)} remaining to disburse`;
        remText.style.color = '';
      }
    }
  } else {
    if (fillEl) fillEl.style.width = '0%';
    if (remText) remText.textContent = 'Enter sanctioned amount in Step 1 first';
  }
}

/* ═══════════════════════════════════════════
   COLLECT FORM DATA
   ═══════════════════════════════════════════ */
function collectFormData() {
  const morStart = document.getElementById('moratorium-start').value;
  const morEnd = document.getElementById('moratorium-end').value;
  const siType = document.querySelector('input[name="si-type"]:checked').value;

  const disbursements = [];
  document.querySelectorAll('.disb-date, .disb-amount').forEach(() => { }); // noop
  document.querySelectorAll('.disbursement-row').forEach(row => {
    const date = row.querySelector('.disb-date').value;
    const amount = parseFloat(row.querySelector('.disb-amount').value) || 0;
    if (date && amount > 0) disbursements.push({ date: date + '-01', amount });
  });

  const prePayments = [];
  document.querySelectorAll('.prepayment-row').forEach(row => {
    const date = row.querySelector('.prep-date').value;
    const amount = parseFloat(row.querySelector('.prep-amount').value) || 0;
    if (date && amount > 0) prePayments.push({ date: date + '-01', amount });
  });

  return {
    sanctionedAmount: parseFloat(document.getElementById('sanctioned-amount').value) || 0,
    annualRate: parseFloat(document.getElementById('interest-rate').value) || 0,
    tenureMonths: parseInt(document.getElementById('tenure').value) || 0,
    moratoriumStart: morStart + '-01',
    moratoriumEnd: morEnd + '-01',
    siOption: {
      type: siType,
      customAmount: siType === 'custom' ? (parseFloat(document.getElementById('si-custom-amount').value) || 0) : 0,
    },
    disbursements,
    prePayments,
  };
}

/* ═══════════════════════════════════════════
   VALIDATION
   ═══════════════════════════════════════════ */
function validate(params, step) {
  const errs = [];
  if (step >= 1) {
    if (!params.sanctionedAmount || params.sanctionedAmount <= 0)
      errs.push('Please enter a valid sanctioned amount.');
    if (!params.annualRate || params.annualRate <= 0)
      errs.push('Please enter a valid annual interest rate.');
    if (!params.tenureMonths || params.tenureMonths <= 0)
      errs.push('Please enter a valid EMI tenure (months).');
    if (!document.getElementById('moratorium-start').value)
      errs.push('Please select the moratorium start date.');
    if (!document.getElementById('moratorium-end').value)
      errs.push('Please select the moratorium end date.');
    if (document.getElementById('moratorium-start').value && document.getElementById('moratorium-end').value) {
      if (new Date(params.moratoriumStart) >= new Date(params.moratoriumEnd))
        errs.push('Moratorium end must be after start.');
    }
  }
  if (step >= 2) {
    if (params.disbursements.length === 0)
      errs.push('Add at least one disbursement before continuing.');
    const totalDisb = params.disbursements.reduce((s, d) => s + d.amount, 0);
    if (totalDisb > params.sanctionedAmount)
      errs.push(`Total disbursements (₹${toIndianFormat(totalDisb)}) exceed sanctioned amount (₹${toIndianFormat(params.sanctionedAmount)}).`);
  }
  return errs;
}

function showError(msg) {
  const el = document.getElementById('error-message');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}
function clearError() {
  const el = document.getElementById('error-message');
  if (el) el.style.display = 'none';
}

/* ═══════════════════════════════════════════
   RENDER RESULTS
   ═══════════════════════════════════════════ */
function renderResults(result) {
  const s = result.summary;

  /* ── Hero metrics ── */
  const heroEl = document.getElementById('results-hero-inner');
  heroEl.innerHTML = `
    <div class="hero-metric">
      <span class="hero-metric-label">Monthly EMI</span>
      <span class="hero-metric-value big highlight">${formatCurrency(s.emi)}</span>
      <span class="hero-metric-sub">${s.emiStartDate} → ${s.emiEndDate}</span>
    </div>
    <div class="hero-metric">
      <span class="hero-metric-label">Grand Total You Pay</span>
      <span class="hero-metric-value danger">${formatCurrency(s.grandTotal)}</span>
      <span class="hero-metric-sub">Including all interest</span>
    </div>
    <div class="hero-metric">
      <span class="hero-metric-label">Total Interest Cost</span>
      <span class="hero-metric-value warning">${formatCurrency(s.totalInterestOverall)}</span>
      <span class="hero-metric-sub">Over ${s.tenureMonths} months</span>
    </div>
    <div class="hero-metric">
      <span class="hero-metric-label">Outstanding at EMI Start</span>
      <span class="hero-metric-value">${formatCurrency(s.outstandingAtMoratoriumEnd)}</span>
      <span class="hero-metric-sub">Principal on which EMI is calculated</span>
    </div>
  `;

  /* ── Breakdown bar ── */
  const principal = s.totalDisbursed;
  const interest = s.totalInterestOverall;
  const siPaid = s.totalSIPaid;
  const prePayments = s.totalPrePayments;
  const grand = s.grandTotal;

  const barEl = document.getElementById('breakdown-bar');
  const legEl = document.getElementById('breakdown-legend');

  const segments = [
    { label: 'Principal', amount: principal, color: '#0071e3' },
    { label: 'Interest', amount: interest, color: '#ff6b35' },
    { label: 'SI Paid during moratorium', amount: siPaid, color: '#af52de' },
    { label: 'Pre-payments', amount: prePayments, color: '#34c759' },
  ].filter(s => s.amount > 0);

  const total = segments.reduce((t, s) => t + s.amount, 0) || 1;
  barEl.innerHTML = segments.map(seg => `
    <div class="breakdown-seg" style="flex:${seg.amount / total};background:${seg.color}" title="${seg.label}: ${formatCurrency(seg.amount)}"></div>
  `).join('');

  legEl.innerHTML = segments.map(seg => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${seg.color}"></span>
      <span class="legend-label">${seg.label}</span>
      <span class="legend-value">${formatCurrency(seg.amount)}</span>
    </div>
  `).join('');

  /* ── Metrics grid ── */
  const metrics = [
    { label: 'Disbursed Amount', value: formatCurrency(s.totalDisbursed), sub: `Sanctioned: ${formatCurrency(s.sanctionedAmount)}`, cls: 'accent-blue-card' },
    { label: 'Annual Interest Rate', value: s.annualRate + '%', sub: `Monthly: ${(s.annualRate / 12).toFixed(3)}%`, cls: 'accent-orange-card' },
    { label: 'Moratorium Duration', value: s.moratoriumMonths + ' months', sub: `${Math.floor(s.moratoriumMonths / 12)}yr ${s.moratoriumMonths % 12}mo`, cls: '' },
    { label: 'EMI Tenure', value: s.tenureMonths + ' months', sub: `${Math.floor(s.tenureMonths / 12)} years`, cls: '' },
    { label: 'Monthly EMI', value: formatCurrency(s.emi), sub: 'Fixed for ' + s.tenureMonths + ' months', cls: 'accent-blue-card' },
    { label: 'Total EMI Payments', value: formatCurrency(s.totalEMIPaid), sub: `${s.tenureMonths} × ${formatCurrency(s.emi)}`, cls: 'accent-orange-card' },
    { label: 'SI Paid During Study', value: formatCurrency(s.totalSIPaid), sub: 'Reduces EMI-phase balance', cls: 'accent-green-card' },
    { label: 'Pre-payments Made', value: formatCurrency(s.totalPrePayments), sub: 'Reduces principal & future EMI', cls: 'accent-green-card' },
    { label: 'Total Interest Overall', value: formatCurrency(s.totalInterestOverall), sub: `Cost of borrowing over full tenure`, cls: 'accent-red-card' },
    { label: 'Grand Total Paid', value: formatCurrency(s.grandTotal), sub: 'Principal + all interest', cls: 'accent-purple-card' },
  ];

  document.getElementById('metrics-grid').innerHTML = metrics.map(m => `
    <div class="metric-card ${m.cls}">
      <div class="metric-label">${m.label}</div>
      <div class="metric-value">${m.value}</div>
      <div class="metric-sub">${m.sub}</div>
    </div>
  `).join('');

  /* ── Panel descriptors ── */
  document.getElementById('moratorium-panel-desc').textContent =
    `${s.moratoriumMonths} months — Total interest accrued: ${formatCurrency(result.moratorium.totalInterestAccrued)}. ${s.totalSIPaid > 0 ? 'You paid ' + formatCurrency(s.totalSIPaid) + ' in SI during this phase.' : ''}`;
  document.getElementById('emi-panel-desc').textContent =
    `${s.tenureMonths} months starting ${s.emiStartDate}. ${s.emiStartDate} → ${s.emiEndDate}. EMI: ${formatCurrency(s.emi)}/month.`;

  // Rate display inside moratorium table
  const rateEl = document.getElementById('rate-display-1');
  if (rateEl) rateEl.textContent = s.annualRate + '%';

  /* ── Moratorium table with per-disbursement breakdown ── */
  const morTbody = document.getElementById('moratorium-tbody');
  const rate = s.annualRate;
  const monthlyR = (rate / 12).toFixed(4);

  let tableRows = '';
  result.moratorium.schedule.forEach((row, idx) => {
    const hasBreakdown = row.disbBreakdown && row.disbBreakdown.length > 0;
    const expandId = `mor-expand-${idx}`;
    const trClass = row.disbursement > 0 ? 'tr-new-disb' : '';

    // Build per-disbursement breakdown HTML (shown when expanded)
    let breakdownHTML = '';
    if (hasBreakdown) {
      breakdownHTML = `
        <tr class="breakdown-detail-row" id="${expandId}" style="display:none">
          <td colspan="8" class="breakdown-td">
            <div class="breakdown-detail">
              <div class="bd-section-title">📊 Interest Breakdown — ${row.month}</div>

              <!-- Per-disbursement interest table -->
              <table class="bd-table">
                <thead>
                  <tr>
                    <th>Disbursement #</th>
                    <th>Disbursed On</th>
                    <th>Active Principal</th>
                    <th>Formula</th>
                    <th>Interest This Month</th>
                    <th>Cumulative Interest</th>
                  </tr>
                </thead>
                <tbody>
                  ${row.disbBreakdown.map(br => `
                     <tr${br.isNewThisMonth ? ' class="bd-new-disb"' : ''}>
                       <td><span class="bd-badge blue">D${br.id}</span></td>
                       <td>${br.disbDate}</td>
                       <td class="bd-amount">${formatCurrency(br.principal)}</td>
                       <td class="bd-formula">${br.isNewThisMonth ? '<em style="color:var(--teal)">Disbursed this month — interest starts next month</em>' : `${formatCurrency(br.principal)} × ${rate}% ÷ 12`}</td>
                       <td class="bd-interest">${br.isNewThisMonth ? '—' : formatCurrencyExact(br.interest)}</td>
                       <td class="bd-cum">${formatCurrencyExact(br.cumInterest)}</td>
                     </tr>
                  `).join('')}
                  ${row.disbBreakdown.length > 1 ? `
                    <tr class="bd-total-row">
                      <td colspan="4"><strong>Total interest this month</strong></td>
                      <td class="bd-interest"><strong>${formatCurrencyExact(row.monthInterest)}</strong></td>
                      <td></td>
                    </tr>
                  ` : ''}
                </tbody>
              </table>

              ${row.siPayment > 0 ? `
              <!-- SI payment deduction -->
              <div class="bd-si-section">
                <div class="bd-section-title" style="color:var(--green)">✅ Simple Interest Paid — ${formatCurrencyExact(row.siPayment)}</div>
                <p class="bd-si-note">This SI payment directly reduces your accrued unpaid interest (not the principal). After deduction, remaining unpaid interest = <strong>${formatCurrencyExact(row.accruedInterest)}</strong></p>
                ${row.siBreakdown && row.siBreakdown.length > 0 ? `
                <table class="bd-table" style="margin-top:8px">
                  <thead>
                    <tr><th>Disbursement</th><th>SI Applied (pro-rata)</th><th>Basis</th></tr>
                  </thead>
                  <tbody>
                    ${row.siBreakdown.map(sb => `
                      <tr>
                        <td><span class="bd-badge green">D${sb.id}</span> ${sb.disbDate}</td>
                        <td class="bd-paid">${formatCurrencyExact(sb.siApplied)}</td>
                        <td class="bd-note">Proportional to D${sb.id}'s share of total interest</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>` : ''}
              </div>` : ''}

              ${row.prePayment > 0 ? `
              <!-- Pre-payment applied -->
              <div class="bd-prepay-section">
                <div class="bd-section-title" style="color:var(--purple)">💜 Pre-payment — ${formatCurrency(row.prePayment)}</div>
                <p class="bd-si-note">First clears any accrued interest, then reduces outstanding principal. Running balance after = <strong>${formatCurrency(row.runningBalance)}</strong></p>
              </div>` : ''}

              <!-- How we get to running balance -->
              <div class="bd-flow">
                <span class="bd-flow-item blue">Principal ${formatCurrency(row.outstandingPrincipal)}</span>
                <span class="bd-flow-op">+</span>
                <span class="bd-flow-item orange">Unpaid Interest ${formatCurrencyExact(row.accruedInterest)}</span>
                <span class="bd-flow-op">=</span>
                <span class="bd-flow-item bold">Balance ${formatCurrency(row.runningBalance)}</span>
              </div>
            </div>
          </td>
        </tr>
      `;
    }

    tableRows += `
      <tr class="${trClass}" data-expand="${expandId}" style="cursor:${hasBreakdown ? 'pointer' : 'default'}" title="${hasBreakdown ? 'Click to see breakdown' : ''}">
        <td class="col-left">
          <span class="month-cell">
            ${row.month}
            ${hasBreakdown ? '<span class="expand-hint">▶</span>' : ''}
          </span>
        </td>
        <td class="${row.disbursement > 0 ? 'cell-disbursement' : ''}">${row.disbursement > 0 ? formatCurrency(row.disbursement) : '—'}</td>
        <td class="cell-balance">${formatCurrency(row.outstandingPrincipal)}</td>
        <td class="cell-interest">${formatCurrencyExact(row.monthInterest)}</td>
        <td class="cell-interest">${formatCurrency(row.accruedInterest)}</td>
        <td class="${row.siPayment > 0 ? 'cell-paid' : ''}">${row.siPayment > 0 ? formatCurrencyExact(row.siPayment) : '—'}</td>
        <td class="${row.prePayment > 0 ? 'cell-prepay' : ''}">${row.prePayment > 0 ? formatCurrency(row.prePayment) : '—'}</td>
        <td class="cell-balance">${formatCurrency(row.runningBalance)}</td>
      </tr>
      ${breakdownHTML}
    `;
  });

  morTbody.innerHTML = tableRows;

  // Attach click-to-expand on moratorium rows
  morTbody.querySelectorAll('tr[data-expand]').forEach(tr => {
    tr.addEventListener('click', () => {
      const expandId = tr.dataset.expand;
      const detailRow = document.getElementById(expandId);
      if (!detailRow) return;
      const isOpen = detailRow.style.display !== 'none';
      detailRow.style.display = isOpen ? 'none' : 'table-row';
      const hint = tr.querySelector('.expand-hint');
      if (hint) hint.textContent = isOpen ? '▶' : '▼';
      tr.classList.toggle('row-expanded', !isOpen);
    });
  });

  /* ── EMI table ── */
  const emiTbody = document.getElementById('emi-tbody');
  emiTbody.innerHTML = result.amortization.schedule.map(row => `
    <tr>
      <td class="col-left" style="color:var(--text-tertiary);font-size:0.78rem">${row.month}</td>
      <td class="col-left">${row.monthLabel}</td>
      <td class="cell-balance">${formatCurrency(row.emi)}</td>
      <td class="cell-interest">${formatCurrency(row.interest)}</td>
      <td class="cell-paid">${formatCurrency(row.principal)}</td>
      <td class="${row.balance < 1000 ? 'cell-paid' : 'cell-balance'}">${formatCurrency(row.balance)}</td>
    </tr>
  `).join('');

  /* ── EMI split visuals ── */
  const sched = result.amortization.schedule;
  if (sched.length > 0) {
    const emi = sched[0].emi;
    const renderSplit = (idInt, idPrinc, row) => {
      const intPct = (row.interest / emi * 100).toFixed(1);
      const prPct = (row.principal / emi * 100).toFixed(1);
      const intEl = document.getElementById(idInt);
      const prEl = document.getElementById(idPrinc);
      if (intEl) intEl.style.width = intPct + '%';
      if (intEl) intEl.title = `Interest: ${formatCurrency(row.interest)} (${intPct}%)`;
      if (prEl) prEl.style.width = prPct + '%';
      if (prEl) prEl.title = `Principal: ${formatCurrency(row.principal)} (${prPct}%)`;
    };
    const midIdx = Math.floor(sched.length / 2);
    renderSplit('esv-interest-1', 'esv-principal-1', sched[0]);
    renderSplit('esv-interest-mid', 'esv-principal-mid', sched[midIdx]);
    renderSplit('esv-interest-last', 'esv-principal-last', sched[sched.length - 1]);
  }

  // Set what-if month default
  const morStart = document.getElementById('moratorium-start').value;
  const wiMonth = document.getElementById('whatif-month');
  if (wiMonth && !wiMonth.value && morStart) wiMonth.value = morStart;
}

/* ═══════════════════════════════════════════
   WHAT-IF
   ═══════════════════════════════════════════ */
let lastSimParams = null;
let lastSimResult = null;

function runWhatIf() {
  if (!lastSimParams) return;
  const amount = parseFloat(document.getElementById('whatif-amount').value) || 0;
  const month = document.getElementById('whatif-month').value;
  if (amount <= 0 || !month) return;

  const modParams = {
    ...lastSimParams,
    prePayments: [...lastSimParams.prePayments, { date: month + '-01', amount }],
  };

  const modResult = runSimulation(modParams);
  if (modResult.error) return;

  const orig = lastSimResult.summary;
  const mod = modResult.summary;

  const items = [
    { label: 'Outstanding at EMI Start', before: orig.outstandingAtMoratoriumEnd, after: mod.outstandingAtMoratoriumEnd },
    { label: 'Monthly EMI', before: orig.emi, after: mod.emi },
    { label: 'Total Interest', before: orig.totalInterestOverall, after: mod.totalInterestOverall },
    { label: 'Grand Total Paid', before: orig.grandTotal, after: mod.grandTotal },
  ];

  document.getElementById('comparison-grid').innerHTML = items.map(c => {
    const savings = c.before - c.after;
    return `
      <div class="comparison-card">
        <div class="cmp-label">${c.label}</div>
        <div class="cmp-before">${formatCurrency(c.before)}</div>
        <div class="cmp-after">${formatCurrency(c.after)}</div>
        ${savings > 0 ? `<span class="cmp-savings">Save ${formatCurrency(savings)}</span>` : '<span class="cmp-savings" style="background:var(--orange-bg);color:var(--orange)">No saving</span>'}
      </div>
    `;
  }).join('');

  document.getElementById('whatif-result').style.display = 'block';
}

/* ═══════════════════════════════════════════
   TOGGLE PHASE PANELS
   ═══════════════════════════════════════════ */
function setupPhaseToggle(btnId, wrapperId) {
  const btn = document.getElementById(btnId);
  const wrapper = document.getElementById(wrapperId);
  if (!btn || !wrapper) return;
  btn.addEventListener('click', () => {
    const isOpen = wrapper.style.display !== 'none';
    wrapper.style.display = isOpen ? 'none' : 'block';
    btn.setAttribute('aria-expanded', String(!isOpen));
  });
}

/* ═══════════════════════════════════════════
   INIT & EVENT LISTENERS
   ═══════════════════════════════════════════ */
function init() {
  // Set defaults — moratorium start (= course start)
  const now = new Date();
  const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  document.getElementById('moratorium-start').value = ym(now);
  const morEnd = new Date(now.getFullYear() + 2, now.getMonth(), 1);
  document.getElementById('moratorium-end').value = ym(morEnd);

  // Attach rupee formatter to main fields
  const sanctionedEl = document.getElementById('sanctioned-amount');
  // We need to create words div for main fields — insert after their input-wrap
  function addWordsDiv(inputEl, afterEl) {
    const div = document.createElement('div');
    div.className = 'amount-words';
    div.id = inputEl.id + '-words';
    afterEl.parentNode.insertBefore(div, afterEl.nextSibling);
    attachRupeeFormatter(inputEl, div);
  }

  // Sanctioned amount words
  const sanctWrap = sanctionedEl.closest('.input-wrap');
  if (sanctWrap) addWordsDiv(sanctionedEl, sanctWrap);

  // What-if amount words
  const wiAmtEl = document.getElementById('whatif-amount');
  if (wiAmtEl) {
    const wiWrap = wiAmtEl.closest('.input-wrap');
    if (wiWrap) addWordsDiv(wiAmtEl, wiWrap);
  }

  // Live hints
  document.getElementById('interest-rate').addEventListener('input', updateLiveHints);
  document.getElementById('tenure').addEventListener('input', updateLiveHints);
  document.getElementById('moratorium-start').addEventListener('change', updateMoratoriumHint);
  document.getElementById('moratorium-end').addEventListener('change', updateMoratoriumHint);
  document.getElementById('sanctioned-amount').addEventListener('input', updateLimitBar);

  // SI radio
  document.querySelectorAll('input[name="si-type"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const group = document.getElementById('si-custom-group');
      group.style.display = radio.value === 'custom' ? 'block' : 'none';
    });
  });

  // Add first disbursement row
  createDisbursementRow();
  updateLimitBar();

  // Disbursement / prepayment add buttons
  document.getElementById('add-disbursement').addEventListener('click', createDisbursementRow);

  // ── Disbursement tab switching ──
  document.querySelectorAll('.disb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.disb-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.getElementById('disb-pane-manual').style.display = target === 'manual' ? 'block' : 'none';
      document.getElementById('disb-pane-recurring').style.display = target === 'recurring' ? 'block' : 'none';
    });
  });

  // ── Attach rupee formatter to recurring amount ──
  attachRupeeFormatter(
    document.getElementById('rc-total-amount'),
    document.getElementById('rc-total-words')
  );

  // ── Live instalment count hint (updates as user changes dates/frequency) ──
  function updateRcHint() {
    const startVal = document.getElementById('rc-start-date').value;
    const endVal = document.getElementById('rc-end-date').value;
    const freq = parseInt(document.getElementById('rc-frequency').value) || 1;
    const hint = document.getElementById('rc-count-hint');
    if (!startVal || !endVal) { hint.textContent = ''; hint.className = 'rc-count-hint'; return; }
    const start = new Date(startVal + '-01');
    const end = new Date(endVal + '-01');
    if (end < start) {
      hint.textContent = '⚠ End month must be after start month.';
      hint.className = 'rc-count-hint rc-hint-warn';
      return;
    }
    let count = 0;
    let cur = new Date(start);
    while (cur <= end) { count++; cur.setMonth(cur.getMonth() + freq); }
    const total = parseFloat(document.getElementById('rc-total-amount').value) || 0;
    const each = total > 0 ? ' — ₹' + toIndianFormat(Math.round(total / count)) + ' each' : '';
    hint.textContent = `✓ ${count} instalment${count !== 1 ? 's' : ''} will be generated${each}`;
    hint.className = 'rc-count-hint rc-hint-ok';
  }
  document.getElementById('rc-start-date').addEventListener('change', updateRcHint);
  document.getElementById('rc-end-date').addEventListener('change', updateRcHint);
  document.getElementById('rc-frequency').addEventListener('change', updateRcHint);
  document.getElementById('rc-total-amount').addEventListener('input', updateRcHint);

  // ── Build instalment list from rc fields ──
  function buildInstalments() {
    const startVal = document.getElementById('rc-start-date').value;
    const endVal = document.getElementById('rc-end-date').value;
    const freq = parseInt(document.getElementById('rc-frequency').value) || 1;
    const total = parseFloat(document.getElementById('rc-total-amount').value) || 0;
    if (!startVal || !endVal || total <= 0) return null;
    const start = new Date(startVal + '-01');
    const end = new Date(endVal + '-01');
    if (end < start) return null;
    const dates = [];
    let cur = new Date(start);
    while (cur <= end) {
      dates.push(new Date(cur));
      cur.setMonth(cur.getMonth() + freq);
    }
    if (dates.length === 0) return null;
    const each = Math.round(total / dates.length);
    // last instalment absorbs rounding difference
    return dates.map((d, i) => ({
      yearMonth: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      amount: i < dates.length - 1 ? each : total - each * (dates.length - 1),
    }));
  }

  // ── Preview ──
  document.getElementById('btn-rc-preview').addEventListener('click', () => {
    const items = buildInstalments();
    const previewEl = document.getElementById('rc-preview');
    const tbody = document.getElementById('rc-preview-tbody');
    if (!items) {
      previewEl.style.display = 'none';
      showError('Please fill in Total Amount, Start Month, and End Month (end must be after start).');
      return;
    }
    clearError();
    const total = items.reduce((s, i) => s + i.amount, 0);
    document.getElementById('rc-preview-title').textContent =
      `${items.length} instalment${items.length !== 1 ? 's' : ''}`;
    document.getElementById('rc-preview-badge').textContent =
      'Total ₹' + toIndianFormat(total);
    tbody.innerHTML = items.map((item, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${formatMonthYear(new Date(item.yearMonth + '-01'))}</td>
        <td class="rc-amt">₹${toIndianFormat(item.amount)}</td>
      </tr>
    `).join('');
    previewEl.style.display = 'block';
    previewEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  // ── Add recurring instalments to the disbursement list ──
  document.getElementById('btn-rc-add').addEventListener('click', () => {
    const items = buildInstalments();
    if (!items) return;
    const empty = document.getElementById('disbursement-empty');
    items.forEach(item => {
      disbCounter++;
      const id = disbCounter;
      const list = document.getElementById('disbursements-list');
      const row = document.createElement('div');
      row.className = 'disbursement-row';
      row.id = `disb-row-${id}`;
      row.innerHTML = `
        <div class="row-num">${id}</div>
        <div class="row-fields">
          <div class="row-field">
            <span class="row-label">Disbursement Date</span>
            <div class="row-input-wrap">
              <input type="month" class="row-input disb-date" id="disb-date-${id}" value="${item.yearMonth}" />
            </div>
          </div>
          <div class="row-field">
            <span class="row-label">Amount (₹)</span>
            <div class="row-input-wrap">
              <span class="row-prefix">₹</span>
              <input type="number" class="row-input disb-amount" id="disb-amount-${id}" value="${item.amount}" min="0" step="5000" />
            </div>
            <div class="amount-words" id="disb-words-${id}"></div>
          </div>
        </div>
        <span class="row-badge-rc">🔄 recurring</span>
        <button class="btn-remove-row" title="Remove" data-id="${id}">✕</button>
      `;
      list.appendChild(row);
      attachRupeeFormatter(
        document.getElementById(`disb-amount-${id}`),
        document.getElementById(`disb-words-${id}`)
      );
      row.querySelector('.btn-remove-row').addEventListener('click', () => {
        row.remove();
        updateDisbEmptyState();
        updateLimitBar();
      });
      row.querySelector('.disb-amount').addEventListener('input', updateLimitBar);
      empty.style.display = 'none';
    });
    updateLimitBar();

    // Reset the recurring form so user can add another schedule
    document.getElementById('rc-total-amount').value = '';
    document.getElementById('rc-total-words').textContent = '';
    document.getElementById('rc-total-words').className = 'amount-words';
    document.getElementById('rc-start-date').value = '';
    document.getElementById('rc-end-date').value = '';
    document.getElementById('rc-frequency').value = '1';
    document.getElementById('rc-count-hint').textContent = '';
    document.getElementById('rc-count-hint').className = 'rc-count-hint';
    document.getElementById('rc-preview').style.display = 'none';

    // Flash success
    const btn = document.getElementById('btn-rc-add');
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ Added!';
    btn.style.background = 'var(--green)';
    setTimeout(() => {
      btn.innerHTML = orig;
      btn.style.background = '';
    }, 1800);
  });

  document.getElementById('add-prepayment').addEventListener('click', createPrepaymentRow);

  // Step navigation
  document.getElementById('btn-step1-next').addEventListener('click', () => {
    const params = collectFormData();
    const errs = validate(params, 1);
    if (errs.length) { showError(errs[0]); return; }
    clearError();
    showStep(2);
  });

  document.getElementById('btn-step2-back').addEventListener('click', () => showStep(1));
  document.getElementById('btn-step2-next').addEventListener('click', () => {
    const params = collectFormData();
    const errs = validate(params, 2);
    if (errs.length) { showError(errs[0]); return; }
    clearError();
    showStep(3);
  });

  document.getElementById('btn-step3-back').addEventListener('click', () => showStep(2));

  // Nav step pills
  document.querySelectorAll('.step-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const target = parseInt(pill.dataset.step);
      if (target < currentStep) showStep(target);
      // Don't allow jumping forward past validated steps
    });
  });

  // Calculate
  document.getElementById('btn-calculate').addEventListener('click', () => {
    const params = collectFormData();
    const errs = validate(params, 2);
    if (errs.length) { showError(errs[0]); return; }
    clearError();

    const result = runSimulation(params);
    if (result.error) { showError(result.error); return; }

    lastSimParams = params;
    lastSimResult = result;

    renderResults(result);
    showStep(4);
  });

  // Edit button on results
  document.getElementById('btn-edit').addEventListener('click', () => showStep(1));

  // Phase toggles
  setupPhaseToggle('toggle-moratorium', 'moratorium-table-wrapper');
  setupPhaseToggle('toggle-emi', 'emi-table-wrapper');

  // What-if
  document.getElementById('btn-whatif').addEventListener('click', runWhatIf);

  // History drawer
  document.getElementById('btn-history-open').addEventListener('click', openHistoryDrawer);
  document.getElementById('btn-history-close').addEventListener('click', closeHistoryDrawer);
  document.getElementById('history-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeHistoryDrawer();
  });

  // Save calculation
  document.getElementById('btn-save-calc').addEventListener('click', async () => {
    const nameEl = document.getElementById('save-calc-name');
    const feedback = document.getElementById('save-calc-feedback');
    const name = nameEl.value.trim();
    if (!name) {
      feedback.textContent = '⚠ Please enter a name first.';
      feedback.className = 'save-calc-feedback warn';
      nameEl.focus();
      return;
    }
    if (!lastSimParams || !lastSimResult) {
      feedback.textContent = '⚠ Run a calculation first.';
      feedback.className = 'save-calc-feedback warn';
      return;
    }
    const btn = document.getElementById('btn-save-calc');
    btn.textContent = 'Saving…';
    btn.disabled = true;
    const err = await saveCalculation(name, lastSimParams, lastSimResult.summary);
    btn.disabled = false;
    btn.textContent = 'Save';
    if (err) {
      feedback.textContent = '✕ Could not save. Check your connection.';
      feedback.className = 'save-calc-feedback warn';
    } else {
      feedback.textContent = '✓ Saved! Find it in History anytime.';
      feedback.className = 'save-calc-feedback ok';
      nameEl.value = '';
      setTimeout(() => { feedback.textContent = ''; feedback.className = 'save-calc-feedback'; }, 4000);
    }
  });

  // Initial display
  showStep(1);
}

// ── Add styles for amount-words display ──
const style = document.createElement('style');
style.textContent = `
  .amount-words {
    font-size: 0.75rem;
    color: var(--text-tertiary);
    margin-top: 5px;
    min-height: 1.1em;
    opacity: 0;
    transform: translateY(-4px);
    transition: all 0.2s ease;
    line-height: 1.4;
    padding: 0 2px;
  }
  .amount-words.show {
    opacity: 1;
    transform: translateY(0);
  }
  .aw-num {
    font-weight: 700;
    color: var(--blue);
    font-variant-numeric: tabular-nums;
  }
  .aw-sep {
    color: var(--text-tertiary);
    margin: 0 4px;
  }
  .aw-words {
    color: var(--text-secondary);
    font-style: italic;
  }
  /* Empty state flex fix */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
`;
document.head.appendChild(style);

document.addEventListener('DOMContentLoaded', init);
