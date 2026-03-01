import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ryjyqudjldpzppkzzksf.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_puWDYgTEUzBDC7VqHyzZWQ_IVtezF2c';

export const supabase = createClient(supabaseUrl, supabaseKey);
