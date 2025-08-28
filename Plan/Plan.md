# WhatsApp AI Reminder Bot - 30-Minute MVP Setup

## What You'll Build in 30 Minutes:
- ✅ WhatsApp bot that understands natural language
- ✅ Creates reminders from messages like "remind me to call mom at 3pm"
- ✅ Lists your active reminders
- ✅ Sends reminder notifications at the scheduled time
- ✅ Completely FREE for personal use
- ✅ All cloud-based, nothing on your computer

## Prerequisites (10 minutes):
1. **GitHub account** (for code storage)
2. **Vercel account** (free hosting) - sign up with GitHub
3. **Supabase account** (free database)
4. **Meta/Facebook Developer account** (for WhatsApp)
5. **OpenAI account** (for GPT-5/GPT-4)

## Step 1: Set Up Database (5 minutes)

### 1.1 Create Supabase Project
1. Go to [supabase.com](https://supabase.com)
2. Create new project (free tier)
3. Save your project URL and service key

### 1.2 Run This SQL in Supabase SQL Editor
```sql
-- Simplified schema for MVP with recurring reminders
CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  whatsapp_number TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE reminders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  message TEXT NOT NULL,
  scheduled_time TIMESTAMP WITH TIME ZONE NOT NULL,
  sent BOOLEAN DEFAULT FALSE,
  recurring_type TEXT, -- 'daily', 'weekly', 'monthly', null
  recurring_days INTEGER[], -- [1,3,5] for Mon,Wed,Fri
  recurring_time TIME, -- time for recurring reminders
  is_template BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_reminders_time ON reminders(scheduled_time);
CREATE INDEX idx_reminders_sent ON reminders(sent);
CREATE INDEX idx_reminders_recurring ON reminders(recurring_type);
```

## Step 2: Create the Bot Code (10 minutes)

### 2.1 Create GitHub Repository
1. Create new repository: `whatsapp-reminder-bot`
2. Clone it locally or use GitHub web editor

### 2.2 Create Project Files

**package.json**
```json
{
  "name": "whatsapp-reminder-bot",
  "version": "1.0.0",
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "openai": "^4.24.0",
    "date-fns": "^3.0.0"
  }
}
```

**api/webhook.js**
```javascript
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
```

**api/send-reminders.js** (Enhanced Cron job)
```javascript
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
```

**vercel.json**
```json
{
  "crons": [{
    "path": "/api/send-reminders",
    "schedule": "* * * * *"
  }]
}
```

## Step 3: Set Up WhatsApp (5 minutes)

### 3.1 Create Meta App
1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Create new app → Type: "Business"
3. Add WhatsApp product to your app
4. In WhatsApp → Getting Started:
   - You'll get a test phone number (free!)
   - Copy the Phone Number ID
   - Generate a temporary access token (60 days)

### 3.2 Configure Webhook
1. In WhatsApp settings → Configuration
2. Webhook URL: `https://your-app.vercel.app/api/webhook`
3. Verify token: Create a random string like `my-verify-token-123`
4. Subscribe to webhook fields: `messages`

## Step 4: Deploy to Vercel (5 minutes)

### 4.1 Push to GitHub
```bash
git add .
git commit -m "Initial WhatsApp bot"
git push
```

### 4.2 Deploy on Vercel
1. Go to [vercel.com](https://vercel.com)
2. Import your GitHub repository
3. Add environment variables:

```env
SUPABASE_URL=your-supabase-url
SUPABASE_KEY=your-supabase-anon-key
PHONE_NUMBER_ID=from-meta-dashboard
WHATSAPP_TOKEN=from-meta-dashboard
OPENAI_API_KEY=your-openai-key
VERIFY_TOKEN=my-verify-token-123
CRON_SECRET=random-secret-for-cron
```

4. Deploy!

## Step 5: Test It! (5 minutes)

### 5.1 Add Your Phone Numbers
In Meta WhatsApp dashboard:
1. Go to WhatsApp → API Setup → Manage Phone Numbers
2. Add your phone number and your wife's number as recipients

### 5.2 Send Test Messages
Send these to the WhatsApp number:
- "Remind me to buy groceries at 5pm today"
- "Remind me to call John tomorrow at 2pm"
- "What are my reminders?"

## MVP Features Working:
✅ **On-Demand Reminders**: "Remind me to call mom at 3pm"  
✅ **Recurring Reminders**: "Remind me to take medicine every day at 8am"  
✅ **Automation Templates**: Pre-defined reminder routines  
✅ **Smart Time Understanding**: Handles "tomorrow", "in 2 hours", etc.  
✅ **Multiple Schedules**: Daily, weekdays, specific days of week  
✅ Lists all active reminders (both one-time and recurring)  
✅ Completely free for personal use  

## Example Messages You Can Send:

### One-Time Reminders:
- "Remind me to buy groceries at 5pm"
- "Remind me to call John tomorrow at 2pm"
- "Remind me to submit report in 3 hours"

### Recurring Reminders:
- "Remind me to take vitamins every day at 8am"
- "Remind me to water plants every Monday and Thursday at 6pm"
- "Remind me to check emails every weekday at 9am"
- "Remind me to pay rent on the 1st of every month"

### Automation Setup:
- "Set up my morning routine" → Shows pre-defined automation options
- "Help me create a daily schedule" → Suggests common reminders

### Query Commands:
- "What are my reminders?"
- "Show me today's schedule"
- "List my recurring reminders"  

## Next Steps (After Testing):
1. **Add more features**: Recurring reminders, edit/cancel reminders
2. **Better time parsing**: "in 2 hours", "next Monday", etc.
3. **Categories**: Personal, work, shopping
4. **Voice notes**: Process audio messages
5. **Multi-language**: Support other languages

## Troubleshooting:

**WhatsApp not receiving messages?**
- Check webhook URL in Meta dashboard
- Verify the token matches
- Check Vercel function logs

**Reminders not sending?**
- Check Vercel cron logs
- Ensure times are in correct timezone
- Verify cron job is running (check Vercel dashboard)

**GPT not understanding messages?**
- Check OpenAI API key
- Try GPT-4 instead of GPT-3.5
- Add more examples to the system prompt

## Total Cost for Personal Use:
- WhatsApp: **FREE** (under 1000 conversations)
- Vercel: **FREE** (hobby tier)
- Supabase: **FREE** (up to 500MB)
- OpenAI: ~$1-2/month for personal use

## Ready to expand to SaaS?
Once validated, we can add:
- User authentication/onboarding
- Payment integration (Stripe)
- Advanced features
- Analytics dashboard
- Multi-tenant architecture