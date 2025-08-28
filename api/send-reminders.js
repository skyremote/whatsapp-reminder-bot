import { createClient } from '@supabase/supabase-js';
import { addDays, setHours, setMinutes, getDay } from 'date-fns';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  // Security check
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 1. Send due one-time reminders
    const { data: dueReminders } = await supabase
      .from('reminders')
      .select('*, users(*)')
      .lte('scheduled_time', new Date().toISOString())
      .eq('sent', false)
      .is('recurring_type', null);

    for (const reminder of dueReminders || []) {
      await sendWhatsAppMessage(
        reminder.users.whatsapp_number,
        `🔔 Reminder: ${reminder.message}`
      );
      
      await supabase
        .from('reminders')
        .update({ sent: true })
        .eq('id', reminder.id);
    }

    // 2. Process recurring reminder templates
    const { data: templates } = await supabase
      .from('reminders')
      .select('*')
      .eq('is_template', true)
      .not('recurring_type', 'is', null);

    for (const template of templates || []) {
      await processRecurringTemplate(template);
    }

    res.json({ 
      sent: dueReminders?.length || 0,
      recurring_processed: templates?.length || 0 
    });
  } catch (error) {
    console.error('Cron error:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
}

async function processRecurringTemplate(template) {
  const now = new Date();
  const currentDay = getDay(now); // 0 = Sunday, 1 = Monday, etc.
  
  // Check if we need to create a reminder for today
  let shouldCreate = false;
  
  switch (template.recurring_type) {
    case 'daily':
      shouldCreate = true;
      break;
    
    case 'weekdays':
      shouldCreate = currentDay >= 1 && currentDay <= 5; // Mon-Fri
      break;
    
    case 'weekly':
      if (template.recurring_days) {
        // Convert Sunday = 0 to Sunday = 7 for our system
        const adjustedDay = currentDay === 0 ? 7 : currentDay;
        shouldCreate = template.recurring_days.includes(adjustedDay);
      }
      break;
    
    case 'monthly':
      // Check if it's the right day of month
      shouldCreate = now.getDate() === new Date(template.scheduled_time).getDate();
      break;
  }
  
  if (shouldCreate) {
    // Check if we already created one today
    const [hours, minutes] = template.recurring_time.split(':');
    const todayTime = setMinutes(setHours(now, parseInt(hours)), parseInt(minutes));
    
    const { data: existing } = await supabase
      .from('reminders')
      .select('id')
      .eq('user_id', template.user_id)
      .eq('message', template.message)
      .gte('scheduled_time', new Date(now.setHours(0, 0, 0, 0)).toISOString())
      .lte('scheduled_time', new Date(now.setHours(23, 59, 59, 999)).toISOString());
    
    if (!existing || existing.length === 0) {
      // Create today's instance
      await supabase
        .from('reminders')
        .insert({
          user_id: template.user_id,
          message: template.message,
          scheduled_time: todayTime.toISOString(),
          sent: false
        });
    }
  }
}

async function sendWhatsAppMessage(to, text) {
  await fetch(
    `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: text }
      })
    }
  );
}