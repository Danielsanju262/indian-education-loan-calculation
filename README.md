# LoanLens — Indian Education Loan Calculator

A specialized education loan simulator designed for Indian students. Understand exactly how interest accrues during your course, how disbursements affect your balance, and how pre-payments can save you lakhs in interest.

## 🚀 Live Demo
*(Click "Edit" on this line to add your deployment URL later)*

## ✨ Key Features

- **Accurate Indian Math**: Uses the Indian comma system (₹10,00,000) and calculates interest based on actual disbursed amounts, not just the total sanctioned limit.
- **Smart Disbursement Scheduling**:
    - **Manual Entry**: Add individual semester/year fees.
    - **Recurring / Spread**: Auto-generate equal instalments over a chosen date range (Monthly, Quarterly, Semi-Annual, etc.).
- **Moratorium Simulation**:
    - Support for "Grace Periods" (Course + 6/12 months).
    - Optional Simple Interest (SI) payment simulation during the study period.
    - Accrued interest tracking (shows how your loan balance grows before EMI starts).
- **History & Save (Supabase)**:
    - Save your simulations with custom names.
    - No login required (uses anonymous browser tokens).
    - Access your saved history anytime on the same device.
- **What-If Analysis**: Instantly compare how a lump-sum pre-payment today affects your total interest cost and monthly EMI.
- **Detailed Breakdowns**: Expandable per-month interest calculation tables.

## 🛠️ Tech Stack

- **Frontend**: Vanilla JavaScript + HTML5 + CSS3 (Apple-inspired Design System)
- **Backend/Database**: [Supabase](https://supabase.com/)
- **Build Tool**: [Vite](https://vite.dev/)

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

## ⚙️ Supabase Setup (Optional)

To enable the History saving feature, create a table in your Supabase SQL Editor:

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

Update your `src/supabase.js` with your project URL and Key.

## 📄 License
MIT
