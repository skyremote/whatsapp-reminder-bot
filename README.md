# WhatsApp AI Reminder Bot

An intelligent WhatsApp bot that understands natural language to create and manage reminders. Built with OpenAI GPT, Supabase, and Vercel.

## ✨ Features

- 🧠 **Natural Language Processing**: "Remind me to call mom at 3pm"
- ⏰ **One-time Reminders**: Set specific date/time reminders
- 🔄 **Recurring Reminders**: Daily, weekly, monthly schedules
- 📋 **List Management**: View all active reminders
- 🤖 **Automation Templates**: Pre-built reminder routines
- 💰 **Free for Personal Use**: Under WhatsApp's free tier limits

## 🚀 Quick Start (30 minutes)

### Prerequisites

1. [GitHub account](https://github.com) - for code storage
2. [Vercel account](https://vercel.com) - free hosting (sign up with GitHub)
3. [Supabase account](https://supabase.com) - free database
4. [Meta Developer account](https://developers.facebook.com) - for WhatsApp
5. [OpenAI account](https://openai.com) - for GPT API

### Step 1: Database Setup (5 minutes)

1. Go to [supabase.com](https://supabase.com) and create a new project
2. In the SQL Editor, run the database setup SQL (see below)
3. Save your project URL and service key

### Step 2: WhatsApp Setup (5 minutes)

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Create new app → Type: "Business"
3. Add WhatsApp product
4. In WhatsApp → Getting Started:
   - Copy the Phone Number ID
   - Generate a temporary access token
5. In Configuration:
   - Webhook URL: `https://your-app.vercel.app/api/webhook`
   - Verify token: Create a random string (e.g., `my-verify-token-123`)
   - Subscribe to: `messages`

### Step 3: Deploy to Vercel (10 minutes)

1. Fork this repository
2. Import to Vercel from GitHub
3. Add environment variables (see `.env.example`)
4. Deploy!

### Step 4: Test Your Bot (10 minutes)

1. Add your phone number in Meta WhatsApp dashboard
2. Send test messages to your WhatsApp number:
   - "Remind me to buy groceries at 5pm today"
   - "What are my reminders?"

## 📱 Example Commands

### One-time Reminders
```
Remind me to call John tomorrow at 2pm
Remind me to submit report in 3 hours
Remind me to buy groceries at 5pm today
```

### Recurring Reminders
```
Remind me to take vitamins every day at 8am
Remind me to water plants every Monday and Thursday at 6pm
Remind me to check emails every weekday at 9am
```

### List & Manage
```
What are my reminders?
Show me today's schedule
Set up my morning routine
```

## 🔧 Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```env
# Supabase
SUPABASE_URL=your-supabase-project-url
SUPABASE_KEY=your-supabase-anon-key

# WhatsApp (from Meta Developer Dashboard)
PHONE_NUMBER_ID=your-whatsapp-phone-number-id
WHATSAPP_TOKEN=your-whatsapp-access-token
VERIFY_TOKEN=your-webhook-verify-token

# OpenAI
OPENAI_API_KEY=your-openai-api-key

# Security
CRON_SECRET=your-random-cron-secret
```

## 🗄️ Database Schema

The bot uses a simple two-table schema in Supabase:

- `users` - WhatsApp phone numbers
- `reminders` - Reminder data with recurring support

## 📊 Costs (Personal Use)

- **WhatsApp**: FREE (under 1000 conversations/month)
- **Vercel**: FREE (hobby tier)
- **Supabase**: FREE (up to 500MB)
- **OpenAI**: ~$1-2/month for personal use

**Total: ~$1-2/month**

## 🔍 Troubleshooting

**WhatsApp not receiving messages?**
- Check webhook URL in Meta dashboard
- Verify the token matches your `.env`
- Check Vercel function logs

**Reminders not sending?**
- Check Vercel cron logs
- Verify timezone settings
- Ensure CRON_SECRET is set

**GPT not understanding messages?**
- Check OpenAI API key
- Try GPT-4 instead of GPT-3.5-turbo
- Check API usage limits

## 🛠️ Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Deploy to Vercel
npm run deploy
```

## 📈 Scaling to SaaS

Once you validate the concept, you can extend it to:
- Multi-tenant architecture
- User authentication
- Payment integration (Stripe)
- Advanced scheduling features
- Analytics dashboard
- Team/workspace features

## 📝 License

MIT - Feel free to use for personal or commercial projects.

---

**Ready to never forget anything again? 🧠✨**