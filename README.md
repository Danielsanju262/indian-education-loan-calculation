# 🎓 LoanLens — Indian Education Loan Clarity

A powerful, specialized education loan simulator designed to help Indian students navigate the complexities of study loans. Unlike standard EMI calculators, **LoanLens** accounts for moratoriums, varying disbursement schedules, and simple interest payments during the study period.

## 🌟 Why LoanLens?

Most calculators assume you receive the full loan amount on day one. In reality, bank loans for education are far more complex:
- **Tranche-based Interest**: You only pay interest on what is *actually released* (disbursed), not the full sanctioned limit.
- **The "Next Month" Rule**: Interest typically starts from the month *after* a disbursement is made.
- **Moratorium Grace**: Interest accrues while you study (often for 2-4 years + a 6-12 month grace period). 

LoanLens makes this math transparent so you can plan your finances with confidence.

---

## 🚀 Key Features

### 🇮🇳 Built for India
- **Indian Numbering System**: Clean formatting for Lakhs and Crores (e.g., ₹10,00,000).
- **Live Words Conversion**: Instantly converts amounts into words (e.g., "Ten Lakh Fifty Thousand Only") to prevent entry errors.

### 📅 Advanced Disbursement Management
- **Manual Tranches**: Add specific dates and amounts for each semester or year.
- **Smart Recurring Spread**: Instantly generate equal instalments (Monthly, Quarterly, Semi-Annual, Annual) over a custom date range. 
- **Real-time Limit Tracking**: Visual progress bar showing total disbursements vs. sanctioned limit.

### 💡 Moratorium & Study Period Simulation
- **Flexible SI Options**:
  - **No Payment**: See how unpaid interest adds up and increases your future EMI.
  - **Formula-based SI**: Simulate paying monthly simple interest to keep your principal low.
  - **Fixed Monthly Payment**: Set a specific monthly amount requested by your bank.
- **Pre-payment Simulation**: Add lump-sum payments during the moratorium to see exactly how much you can save.

### 📊 Deep Analytics & Visualization
- **Aesthetic Hero Summary**: Dark-themed results card with high-priority metrics: Grand Total, Total Interest, and Outstanding at EMI Start.
- **"Where your money goes"**: Visual breakdown of your total repayment into Principal vs. Interest components.
- **Interactive Tables**: Expandable per-month schedules for both the Moratorium and Repayment phases.
- **"What-If" Analysis**: Instantly compare how a lump-sum pre-payment today affects your total interest cost and monthly EMI.

### 💾 Persistence (No Login Required)
- **Save & Name**: Save multiple simulations to compare different banks or scenarios.
- **History Drawer**: Access your saved calculations anytime on the same device.
- **Privacy-First**: Uses anonymous browser tokens via Supabase — no account needed.

---

## 🛠️ Tech Stack

- **Vite**: Ultra-fast build tool and development server.
- **Vanilla JavaScript**: High-performance core logic.
- **CSS3 (Apple-inspired)**: Premium UI with smooth transitions, glassmorphism, and responsive layouts.
- **Supabase**: Backend for storing history using anonymous authentication.

---

## 🏃 Getting Started Locally

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Danielsanju262/indian-education-loan-calculation.git
   cd indian-education-loan-calculation
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```

---

## ⚙️ Supabase Configuration

To enable the History feature, create a table in your Supabase SQL Editor:

```sql
create table loan_calculations (
  id uuid primary key default gen_random_uuid(),
  user_token text not null,
  name text not null,
  params jsonb not null,
  summary jsonb not null,
  created_at timestamptz default now()
);

-- Set up Row Level Security (RLS)
alter table loan_calculations enable row level security;
create policy "Public insert" on loan_calculations for insert with check (true);
create policy "Public select" on loan_calculations for select using (true);
create policy "Public delete" on loan_calculations for delete using (true);
```

Update your `src/supabase.js` with your project credentials.

---

## 📄 License
MIT © 2026 Daniel Sanju
