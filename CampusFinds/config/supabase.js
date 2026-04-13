import { createClient } from '@supabase/supabase-js'
const supabaseUrl = process.env.CAMPUS_WEB_SUPABASE_URL
const supabaseKey = process.env.CAMPUS_WEB_ANON_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

export default supabase