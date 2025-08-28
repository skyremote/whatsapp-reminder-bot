import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { parseISO, format, addDays, setHours, setMinutes } from 'date-fns';

// Initialize services
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
  // WhatsApp webhook verification
  if (req.method === 'GET') {
    const challenge = req.query['hub.challenge'];
    const verify_token = req.query['hub.verify_token'];
    
    if (verify_token === process.env.VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  // Handle incoming messages
  if (req.method === 'POST') {
    try {
      const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!message) return res.status(200).json({ ok: true });
      
      const from = message.from;
      const text = message.text?.body;
      
      // Process message
      const response = await processMessage(from, text);
      
      // Send response
      await sendWhatsAppMessage(from, response);
      
      res.status(200).json({ ok: true });
    } catch (error) {
      console.error(error);
      res.status(200).json({ ok: true }); // Always return 200 to WhatsApp
    }
  }
}

async function processMessage(from, text) {
  // Get or create user
  const { data: user } = await supabase
    .from('users')
    .upsert({ whatsapp_number: from })
    .select()
    .single();

  // Use GPT to understand the message
  const completion = await openai.chat.completions.create({
    model: "gpt-4-turbo-preview",
    messages: [
      {
        role: "system",
        content: `You are a WhatsApp reminder bot. Current time: ${new Date().toISOString()}
        
        Analyze the message and return JSON:
        {
          "action": "CREATE_REMINDER" | "CREATE_RECURRING" | "LIST_REMINDERS" | "SETUP_AUTOMATION" | "CHAT",
          "reminder_text": "what to remember",
          "scheduled_time": "ISO datetime string",
          "recurring_type": "daily" | "weekly" | "weekdays" | "monthly" | null,
          "recurring_days": [1,2,3,4,5], // 1=Mon, 7=Sun
          "recurring_time": "HH:MM" // 24hr format
        }
        
        Examples:
        "remind me to call mom at 3pm" → CREATE_REMINDER
        "remind me to take medicine every day at 8am" → CREATE_RECURRING
        "remind me to exercise every monday and wednesday at 6pm" → CREATE_RECURRING
        "set up my morning routine" → SETUP_AUTOMATION
        "what are my reminders" → LIST_REMINDERS`
      },
      { role: "user", content: text }
    ],
    response_format: { type: "json_object" }
  });

  const intent = JSON.parse(completion.choices[0].message.content);

  // Handle actions
  switch (intent.action) {
    case 'CREATE_REMINDER':
      return await createReminder(user.id, intent);
    
    case 'CREATE_RECURRING':
      return await createRecurringReminder(user.id, intent);
    
    case 'SETUP_AUTOMATION':
      return await setupAutomation(user.id);
    
    case 'LIST_REMINDERS':
      return await listReminders(user.id);
    
    default:
      return `Hi! I can help you with reminders. Try:
• One-time: "Remind me to [task] at [time]"
• Recurring: "Remind me to [task] every day at [time]"
• Automation: "Set up my morning routine"
• View: "What are my reminders?"`;
  }
}

async function createReminder(userId, intent) {
  const { data, error } = await supabase
    .from('reminders')
    .insert({
      user_id: userId,
      message: intent.reminder_text,
      scheduled_time: intent.scheduled_time,
      recurring_type: null
    })
    .select()
    .single();

  if (error) return "Sorry, I couldn't create that reminder.";
  
  const time = format(parseISO(intent.scheduled_time), 'MMM d at h:mm a');
  return `✅ Reminder set for ${time}: "${intent.reminder_text}"`;
}

async function createRecurringReminder(userId, intent) {
  // Create the recurring template
  const { data, error } = await supabase
    .from('reminders')
    .insert({
      user_id: userId,
      message: intent.reminder_text,
      scheduled_time: intent.scheduled_time,
      recurring_type: intent.recurring_type,
      recurring_days: intent.recurring_days,
      recurring_time: intent.recurring_time,
      is_template: true
    })
    .select()
    .single();

  if (error) return "Sorry, I couldn't create that recurring reminder.";
  
  // Create first instance
  await createNextRecurringInstance(data);
  
  let schedule = intent.recurring_type;
  if (intent.recurring_type === 'weekly' && intent.recurring_days) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    schedule = intent.recurring_days.map(d => days[d-1]).join(', ');
  }
  
  return `🔄 Recurring reminder set!\n"${intent.reminder_text}"\nSchedule: ${schedule} at ${intent.recurring_time}`;
}

async function setupAutomation(userId) {
  const automations = [
    {
      name: "💊 Morning Medicine",
      message: "Take your morning medicine",
      time: "08:00",
      type: "daily"
    },
    {
      name: "💧 Stay Hydrated",
      message: "Drink a glass of water",
      time: "10:00,14:00,18:00",
      type: "daily"
    },
    {
      name: "🏃 Exercise",
      message: "Time for your workout!",
      time: "18:00",
      days: [1, 3, 5], // Mon, Wed, Fri
      type: "weekly"
    },
    {
      name: "🗑️ Trash Day",
      message: "Take out the trash",
      time: "19:00",
      days: [2], // Tuesday
      type: "weekly"
    }
  ];

  let response = `📋 Available Automations:\n\n`;
  automations.forEach((auto, i) => {
    response += `${i+1}. ${auto.name}\n`;
  });
  response += `\nReply with numbers to activate (e.g., "1,3" for first and third)`;
  
  // Store automation options in user context (you could use Supabase for this)
  // For now, we'll just show the menu
  
  return response;
}

async function listReminders(userId) {
  // Get one-time reminders
  const { data: oneTime } = await supabase
    .from('reminders')
    .select('*')
    .eq('user_id', userId)
    .eq('sent', false)
    .is('recurring_type', null)
    .order('scheduled_time');

  // Get recurring reminders
  const { data: recurring } = await supabase
    .from('reminders')
    .select('*')
    .eq('user_id', userId)
    .eq('is_template', true)
    .not('recurring_type', 'is', null);

  let response = '';
  
  if (oneTime && oneTime.length > 0) {
    response += `📋 One-time reminders:\n`;
    oneTime.forEach((r, i) => {
      response += `${i+1}. ${r.message} - ${format(parseISO(r.scheduled_time), 'MMM d, h:mm a')}\n`;
    });
  }
  
  if (recurring && recurring.length > 0) {
    response += `\n🔄 Recurring reminders:\n`;
    recurring.forEach((r, i) => {
      response += `${i+1}. ${r.message} - ${r.recurring_type} at ${r.recurring_time}\n`;
    });
  }
  
  if (response === '') {
    response = "📭 No active reminders";
  }
  
  return response;
}

async function createNextRecurringInstance(template) {
  // Logic to create the next instance of a recurring reminder
  const now = new Date();
  let nextTime = new Date();
  
  // Parse the time
  const [hours, minutes] = template.recurring_time.split(':');
  nextTime = setHours(setMinutes(nextTime, parseInt(minutes)), parseInt(hours));
  
  // If time has passed today, schedule for tomorrow
  if (nextTime <= now) {
    nextTime = addDays(nextTime, 1);
  }
  
  // Create the reminder instance
  await supabase
    .from('reminders')
    .insert({
      user_id: template.user_id,
      message: template.message,
      scheduled_time: nextTime.toISOString(),
      recurring_type: null,
      sent: false
    });
}

async function sendWhatsAppMessage(to, text) {
  const response = await fetch(
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
  
  return response.json();
}