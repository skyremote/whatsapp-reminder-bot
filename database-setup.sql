-- WhatsApp Reminder Bot Database Setup
-- Run this SQL in your Supabase SQL Editor

-- Create users table
CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  whatsapp_number TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create reminders table with recurring support
CREATE TABLE reminders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  scheduled_time TIMESTAMP WITH TIME ZONE NOT NULL,
  sent BOOLEAN DEFAULT FALSE,
  recurring_type TEXT CHECK (recurring_type IN ('daily', 'weekly', 'weekdays', 'monthly')),
  recurring_days INTEGER[] CHECK (
    recurring_days IS NULL OR 
    (array_length(recurring_days, 1) > 0 AND 
     recurring_days <@ ARRAY[1,2,3,4,5,6,7])
  ), -- 1=Monday, 7=Sunday
  recurring_time TIME, -- Time for recurring reminders (e.g., '08:00')
  is_template BOOLEAN DEFAULT FALSE, -- True for recurring templates
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_reminders_user_id ON reminders(user_id);
CREATE INDEX idx_reminders_scheduled_time ON reminders(scheduled_time);
CREATE INDEX idx_reminders_sent ON reminders(sent);
CREATE INDEX idx_reminders_recurring_type ON reminders(recurring_type);
CREATE INDEX idx_reminders_is_template ON reminders(is_template);

-- Create composite indexes for common queries
CREATE INDEX idx_reminders_pending ON reminders(sent, scheduled_time) WHERE sent = false;
CREATE INDEX idx_reminders_templates ON reminders(is_template, recurring_type) WHERE is_template = true;

-- Add comments for documentation
COMMENT ON TABLE users IS 'WhatsApp users who interact with the reminder bot';
COMMENT ON TABLE reminders IS 'Reminders created by users, including one-time and recurring templates';

COMMENT ON COLUMN reminders.recurring_type IS 'Type of recurring reminder: daily, weekly, weekdays, monthly';
COMMENT ON COLUMN reminders.recurring_days IS 'Days of week for weekly recurring (1=Mon, 7=Sun)';
COMMENT ON COLUMN reminders.recurring_time IS 'Time of day for recurring reminders';
COMMENT ON COLUMN reminders.is_template IS 'True for recurring reminder templates that generate instances';

-- Enable Row Level Security (RLS) for data protection
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

-- Create policies for secure access
-- Note: In a production app, you'd want more restrictive policies
-- For now, we'll allow service role access (used by our API)

-- Policy for users table
CREATE POLICY "Enable all access for service role" ON users
  FOR ALL USING (auth.role() = 'service_role');

-- Policy for reminders table  
CREATE POLICY "Enable all access for service role" ON reminders
  FOR ALL USING (auth.role() = 'service_role');

-- Optional: Add some helpful functions

-- Function to get user's active reminders
CREATE OR REPLACE FUNCTION get_user_active_reminders(user_phone TEXT)
RETURNS TABLE(
  reminder_id UUID,
  message TEXT,
  scheduled_time TIMESTAMP WITH TIME ZONE,
  is_recurring BOOLEAN,
  recurring_info TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.id,
    r.message,
    r.scheduled_time,
    (r.recurring_type IS NOT NULL) as is_recurring,
    CASE 
      WHEN r.recurring_type IS NOT NULL THEN
        r.recurring_type || ' at ' || r.recurring_time::TEXT
      ELSE NULL
    END as recurring_info
  FROM reminders r
  JOIN users u ON r.user_id = u.id
  WHERE u.whatsapp_number = user_phone
    AND (r.sent = false OR r.is_template = true)
  ORDER BY r.scheduled_time;
END;
$$;

-- Function to clean up old sent reminders (optional, for maintenance)
CREATE OR REPLACE FUNCTION cleanup_old_reminders(days_old INTEGER DEFAULT 30)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM reminders 
  WHERE sent = true 
    AND is_template = false 
    AND created_at < NOW() - INTERVAL '1 day' * days_old;
    
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;