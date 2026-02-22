const { createClient } = window.supabase;

const SUPABASE_URL = 'https://xqhfcdrvttcxvmwctvpt.supabase.co';
const SUPABASE_KEY = 'sb_publishable_h6OpAtsnMgBcyBHne4dDBw_A-hui3DH';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
