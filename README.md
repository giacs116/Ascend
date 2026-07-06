# ▲ Ascend

Your personal fitness companion. Runs entirely on your PC — your phone connects over Wi-Fi, and all your data stays in one SQLite file on your machine.

## Start it

```
npm start
```

The terminal prints two links and a **QR code** — scan it with your phone's camera (phone must be on the same Wi-Fi as this PC).

> **First run:** if Windows shows a firewall prompt for Node.js, click **Allow** (Private networks). Without it your phone can't reach the app.

## Put it on your home screen

- **iPhone (Safari):** open the link → Share button → **Add to Home Screen**
- **Android (Chrome):** open the link → ⋮ menu → **Add to Home screen**

It installs with the Ascend icon and opens full-screen like a native app.

## What's inside

| Area | What it does |
|---|---|
| **Today** | Calorie / protein / water rings, macro meters, streaks, quick actions |
| **Food** | Log meals from a built-in library, by hand, or with AI — type *"2 eggs and toast"* or snap a photo of your plate |
| **Train** | Full workout logger (sets × reps × weight), rest timer, PR detection with confetti, routines, cardio & sports quick-log |
| **Form Check** | Film a set — frames are extracted on your phone and Claude coaches your technique |
| **Progress** | Weight trend, calorie/protein/sugar/water charts, a GitHub-style training heatmap, records, measurements |
| **Coach** | An AI trainer that can see your live stats, meals and lifts — ask it anything |
| **Settings** | Units (lb/kg, cm/ft-in, oz/ml), themes, custom targets, data export |

Targets are computed with the Mifflin-St Jeor formula from your profile (and re-computed as your weight changes), with evidence-based protein (1.6–2.0 g/kg by goal), an AHA added-sugar cap, and ~35 ml/kg water.

## Unlock the AI features

The coach chat, photo calorie estimates, form checks and AI exercise recommendations run on Anthropic's Claude. The key lives in the **`.env` file** in this folder:

1. Get an API key at **console.anthropic.com** (pay-as-you-go)
2. Open `.env` (in this folder) with Notepad and fill in:
   `ANTHROPIC_API_KEY=sk-ant-your-key-here`
3. Restart Ascend (`npm start`) — the startup banner will say **AI: connected ✓**
4. In the app: **Settings → AI coach & vision → Test connection**

The key never leaves this PC and is never included in exports. Default model is Claude Opus 4.8; you can switch models in Settings. Typical costs are small — a chat reply or meal estimate is a few cents; a form check (several images) somewhat more.

## Your data

- Everything lives in `data/ascend.db` (SQLite). Back that file up and you've backed up everything.
- **Settings → Export everything** downloads a full JSON dump (never includes your API key).

## Troubleshooting

- **Phone can't connect** — same Wi-Fi? Firewall allowed? Your PC's address can change occasionally; just re-check the URL/QR printed by `npm start`.
- **Router blocks device-to-device traffic** — some guest/public Wi-Fi networks isolate devices ("AP isolation"). Use your main home network.
- **AI errors** — Settings → *Test connection* tells you exactly what's wrong (bad key, no credit, offline…).
- **Port already in use** — start with another port: `set PORT=5300 && npm start`

## Tech notes

Node 22.5+ (built-in SQLite — no native modules), Express 5, vanilla-JS PWA frontend, official `@anthropic-ai/sdk`. No build step, no cloud, no accounts.
