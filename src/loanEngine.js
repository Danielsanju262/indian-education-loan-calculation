/**
 * Education Loan Calculation Engine
 * All financial math — with per-disbursement interest tracking.
 */

export function monthlyRate(annualRate) {
  return annualRate / 100 / 12;
}

export function monthsBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

export function nextMonth(date) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + 1);
  d.setDate(1);
  return d;
}

export function formatDate(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatMonthYear(date) {
  const d = new Date(date);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatCurrency(amount) {
  return '₹' + Math.round(amount).toLocaleString('en-IN');
}

export function formatCurrencyExact(amount) {
  return '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Standard reducing-balance EMI formula */
export function calculateEMI(principal, annualRate, tenureMonths) {
  if (principal <= 0 || tenureMonths <= 0) return 0;
  const r = monthlyRate(annualRate);
  if (r === 0) return principal / tenureMonths;
  const factor = Math.pow(1 + r, tenureMonths);
  return (principal * r * factor) / (factor - 1);
}

/**
 * Generate moratorium schedule with per-disbursement interest tracking.
 *
 * KEY RULES:
 *   1. Interest on each disbursement starts from the NEXT month after disbursement
 *      (not the same month it was disbursed).
 *   2. Disbursements can happen before course/moratorium start.
 *   3. Schedule runs from the earliest of (moratorium start, first disbursement)
 *      to the moratorium end.
 *   4. Simple interest / accrued interest is charged from the next month after
 *      disbursement, never the same month of disbursement.
 *
 * Returns each monthly row with:
 *   - disbBreakdown: for each disbursement accruing interest this month,
 *       { id, label, principal, interest, cumulativeInterest }
 *   - siBreakdown: how SI payment was proportionally applied per disbursement
 *
 * @param {Array}  disbursements  [{date, amount}]
 * @param {number} annualRate
 * @param {string} moratoriumStart
 * @param {string} moratoriumEnd
 * @param {Object} siOption       {type, customAmount}
 * @param {Array}  prePayments    [{date, amount}]
 */
export function generateMoratoriumSchedule(
  disbursements, annualRate, moratoriumStart, moratoriumEnd, siOption, prePayments
) {
  const r = monthlyRate(annualRate);
  const morStartDate = new Date(moratoriumStart);
  const endDate = new Date(moratoriumEnd);

  const sortedDisb = [...disbursements]
    .filter(d => d.date && d.amount > 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((d, i) => ({ id: i + 1, ...d, cumInterest: 0 }));

  const sortedPrePay = [...prePayments]
    .filter(p => p.date && p.amount > 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const schedule = [];
  let outstandingPrincipal = 0;
  let accruedInterest = 0;
  let totalInterestAccrued = 0;
  let totalSIPaid = 0;
  let totalPrePayments = 0;
  let totalDisbursed = 0;

  // Per-disbursement tracking
  // disbMonthKey tracks the month of disbursement so we can skip interest in that month
  const activeDisb = sortedDisb.map(d => {
    const dd = new Date(d.date);
    return {
      ...d,
      activePrincipal: 0,
      cumInterest: 0,
      disbMonthKey: `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}`,
    };
  });

  // Schedule starts from the earliest of moratorium start or the first disbursement date
  let scheduleStartDate = new Date(morStartDate.getFullYear(), morStartDate.getMonth(), 1);
  if (sortedDisb.length > 0) {
    const firstDisbDate = new Date(sortedDisb[0].date);
    const firstDisbMonth = new Date(firstDisbDate.getFullYear(), firstDisbDate.getMonth(), 1);
    if (firstDisbMonth < scheduleStartDate) {
      scheduleStartDate = firstDisbMonth;
    }
  }

  let currentDate = new Date(scheduleStartDate);
  const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (currentDate <= endMonth) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const currentMonthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

    // ── 1. Disburse this month ──
    let monthDisbursement = 0;
    activeDisb.forEach(d => {
      const dDate = new Date(d.date);
      if (dDate.getFullYear() === year && dDate.getMonth() === month) {
        monthDisbursement += d.amount;
        totalDisbursed += d.amount;
        d.activePrincipal += d.amount;
        outstandingPrincipal += d.amount;
      }
    });

    // ── 2. Per-disbursement interest this month ──
    // Interest is charged ONLY if the disbursement happened in a PREVIOUS month
    // (i.e., NOT the same month of disbursement)
    let monthInterest = 0;
    const disbBreakdown = [];
    activeDisb.forEach(d => {
      if (d.activePrincipal <= 0) return;
      // Skip interest if this disbursement was made THIS month
      if (d.disbMonthKey === currentMonthKey) {
        // Show in breakdown but with 0 interest for transparency
        disbBreakdown.push({
          id: d.id,
          disbDate: formatMonthYear(new Date(d.date)),
          principal: d.activePrincipal,
          interest: 0,
          cumInterest: d.cumInterest,
          rate: annualRate,
          isNewThisMonth: true,
        });
        return;
      }
      const intForDisb = d.activePrincipal * r;
      d.cumInterest += intForDisb;
      disbBreakdown.push({
        id: d.id,
        disbDate: formatMonthYear(new Date(d.date)),
        principal: d.activePrincipal,
        interest: intForDisb,
        cumInterest: d.cumInterest,
        rate: annualRate,
        isNewThisMonth: false,
      });
      monthInterest += intForDisb;
    });
    accruedInterest += monthInterest;
    totalInterestAccrued += monthInterest;

    // ── 3. SI payment this month ──
    // SI is only charged when there is actual interest to pay
    let siPayment = 0;
    if (siOption.type === 'formula') {
      siPayment = monthInterest; // pay exactly the interest accrued this month
    } else if (siOption.type === 'custom') {
      siPayment = siOption.customAmount || 0;
    }

    // SI reduces accrued interest (pro-rata across disbursements)
    let siBreakdown = [];
    let actualSIPaid = 0;
    if (siPayment > 0 && accruedInterest > 0) {
      const actualSI = Math.min(siPayment, accruedInterest);
      actualSIPaid = actualSI;
      totalSIPaid += actualSI;
      accruedInterest -= actualSI;

      // Attribute SI deduction pro-rata to each disbursement's share
      if (monthInterest > 0) {
        disbBreakdown.forEach(br => {
          if (br.interest <= 0) return;
          const share = br.interest / monthInterest;
          siBreakdown.push({
            id: br.id,
            disbDate: br.disbDate,
            siApplied: actualSI * share,
          });
        });
      }
    }

    // ── 4. Pre-payments this month ──
    let monthPrePayment = 0;
    sortedPrePay.forEach(p => {
      const pDate = new Date(p.date);
      if (pDate.getFullYear() === year && pDate.getMonth() === month) {
        monthPrePayment += p.amount;
      }
    });
    if (monthPrePayment > 0) {
      totalPrePayments += monthPrePayment;
      // First clear accrued interest, then reduce principal
      if (monthPrePayment <= accruedInterest) {
        accruedInterest -= monthPrePayment;
      } else {
        const remainder = monthPrePayment - accruedInterest;
        accruedInterest = 0;
        // Reduce principal proportionally across disbursements
        let remaining = remainder;
        for (let i = activeDisb.length - 1; i >= 0 && remaining > 0; i--) {
          const reduce = Math.min(activeDisb[i].activePrincipal, remaining);
          activeDisb[i].activePrincipal -= reduce;
          outstandingPrincipal -= reduce;
          remaining -= reduce;
        }
      }
    }

    schedule.push({
      month: formatMonthYear(currentDate),
      monthKey: currentMonthKey,
      disbursement: monthDisbursement,
      outstandingPrincipal,
      monthInterest,
      accruedInterest,
      siPayment: actualSIPaid,
      prePayment: monthPrePayment,
      totalDisbursed,
      runningBalance: outstandingPrincipal + accruedInterest,
      disbBreakdown,
      siBreakdown,
    });

    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  return {
    schedule,
    totalInterestAccrued,
    totalSIPaid,
    totalPrePayments,
    totalDisbursed,
    outstandingPrincipal,
    accruedInterest,
    outstandingAtEnd: outstandingPrincipal + accruedInterest,
  };
}

/** Standard reducing-balance amortization */
export function generateAmortizationSchedule(principal, annualRate, tenureMonths, startDate) {
  const r = monthlyRate(annualRate);
  const emi = calculateEMI(principal, annualRate, tenureMonths);
  const schedule = [];
  let balance = principal;
  let totalInterest = 0;
  let totalPayment = 0;
  const start = new Date(startDate);

  for (let i = 0; i < tenureMonths && balance > 0.01; i++) {
    const currentDate = new Date(start);
    currentDate.setMonth(start.getMonth() + i);

    const interestComponent = balance * r;
    let principalComponent = emi - interestComponent;
    if (principalComponent > balance) principalComponent = balance;

    const actualEMI = interestComponent + principalComponent;
    balance -= principalComponent;
    totalInterest += interestComponent;
    totalPayment += actualEMI;

    schedule.push({
      month: i + 1,
      monthLabel: formatMonthYear(currentDate),
      emi: actualEMI,
      principal: principalComponent,
      interest: interestComponent,
      balance: Math.max(0, balance),
    });
  }

  return { schedule, emi, totalInterest, totalPayment, principal };
}

/** Full simulation */
export function runSimulation(params) {
  const {
    sanctionedAmount, annualRate, moratoriumStart, moratoriumEnd,
    tenureMonths, disbursements, siOption, prePayments,
  } = params;

  const totalDisbursed = disbursements
    .filter(d => d.date && d.amount > 0)
    .reduce((s, d) => s + d.amount, 0);

  if (totalDisbursed > sanctionedAmount) {
    return { error: `Total disbursements (${formatCurrency(totalDisbursed)}) exceed sanctioned amount (${formatCurrency(sanctionedAmount)})` };
  }

  const moratorium = generateMoratoriumSchedule(
    disbursements, annualRate, moratoriumStart, moratoriumEnd, siOption, prePayments
  );

  const morEndDate = new Date(moratoriumEnd);
  const emiStartDate = new Date(morEndDate.getFullYear(), morEndDate.getMonth() + 1, 1);

  const amortization = generateAmortizationSchedule(
    moratorium.outstandingAtEnd, annualRate, tenureMonths, formatDate(emiStartDate)
  );

  const totalSIPaid = moratorium.totalSIPaid;
  const totalPrePayments = moratorium.totalPrePayments;
  const totalEMIPaid = amortization.totalPayment;
  const totalInterestPaid = moratorium.totalInterestAccrued - moratorium.totalSIPaid + amortization.totalInterest;
  const grandTotal = totalSIPaid + totalPrePayments + totalEMIPaid;

  return {
    moratorium,
    amortization,
    summary: {
      sanctionedAmount,
      totalDisbursed: moratorium.totalDisbursed,
      annualRate,
      tenureMonths,
      moratoriumMonths: moratorium.schedule.length,
      outstandingAtMoratoriumEnd: moratorium.outstandingAtEnd,
      emi: amortization.emi,
      totalSIPaid,
      totalPrePayments,
      totalEMIPaid,
      totalInterestOverall: totalInterestPaid,
      grandTotal,
      emiStartDate: formatMonthYear(emiStartDate),
      emiEndDate: formatMonthYear(new Date(emiStartDate.getFullYear(), emiStartDate.getMonth() + tenureMonths - 1, 1)),
    },
  };
}
