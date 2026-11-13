<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/d5d246e3-d9cb-4a85-ab71-f53556e471f6

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Environment variables

| Variable | Purpose |
| --- | --- |
| `GROQ_API_KEY` | Optional. If set, AI features use Groq (preferred). |
| `GEMINI_API_KEY` | Used for AI features when no Groq key is set. |
| `JWT_SECRET` | Secret for signing auth tokens. **Set this in production.** |

## Scripts

- `npm run dev` – start the Express + Vite dev server on port 3000
- `npm run build` – production build
- `npm run lint` – TypeScript type-check

## API routes

`GET /api/health`, `POST /api/auth/register`, `POST /api/auth/login`,
`GET|PUT /api/user/profile` (auth), `GET /api/jobs`, `GET /api/courses`,
`POST /api/gemini/analyze`.
