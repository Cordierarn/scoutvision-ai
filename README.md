<div align="center">

# ⚽ ScoutVision AI

**Professional Football Scouting Platform**

A modern, data-driven scouting application for football analytics with AI-powered player analysis.

![React](https://img.shields.io/badge/React-19.2-blue?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-6.2-purple?logo=vite)
![TailwindCSS](https://img.shields.io/badge/Tailwind-3.4-cyan?logo=tailwindcss)

</div>

## ✨ Features

- 📊 **Player Database** - Browse and search 80,000+ players with advanced filtering
- 🔍 **Player Comparison** - Compare up to 4 players side-by-side with radar charts
- 🎯 **Similarity Finder** - Find statistically similar players using advanced algorithms
- 💎 **Gem Hunter (Prospects)** - Scout prospects with 21 tactical role presets
- ⚽ **Team Analysis** - Squad depth, tactical profiles, and shot maps
- 📝 **AI Scout Reports** - Generate AI-powered scouting reports with Gemini
- 🌙 **Modern Dark UI** - Glassmorphism design with premium aesthetics

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Gemini API Key (for AI reports)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/scoutvision-ai.git
   cd scoutvision-ai
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env.local` file:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

4. **Add your data files**
   
   Place your CSV files in `public/data/`:
   - `players.csv` - Player statistics (Wyscout format)
   - `shots.csv` - Shot events data
   - `teams.csv` - Team statistics (optional)

5. **Run the development server**
   ```bash
   npm run dev
   ```

## 📁 Data Format

### players.csv
Required columns:
- `Player` - Player name
- `Team` - Current team
- `Position` - Playing position (GK, CB, RB, LB, DMF, CMF, AMF, LW, RW, CF, etc.)
- `Age` - Player age
- `League` - League name with season (e.g., "Premier League 2024-25")
- `Market value` - Transfer value in euros
- `Minutes played` - Total minutes played
- Plus various performance metrics (Goals, xG, Assists, xA, etc.)

### shots.csv
Required columns:
- `Player` - Shooter name
- `Team` - Team name
- `X` - X coordinate (0-100)
- `Y` - Y coordinate (0-100)
- `xG` - Expected goals value
- `Result` - Shot outcome (Goal, Saved, etc.)

## 🎯 Tactical Roles (Gem Hunter)

The app includes 21 pre-configured tactical roles across 9 categories:

| Category | Roles |
|----------|-------|
| 🧤 Goalkeeper | Shot Stopper, Sweeper Keeper |
| 🛡️ Centre Back | Ball Playing, No-Nonsense, Cover Defender |
| 🏃 Full Back | Wing Back, Defensive, Inverted |
| ⚔️ CDM | Anchor Man, Regista |
| 🔄 CM | Box-to-Box, Ball Carrier |
| 🎯 CAM | Number 10, Shadow Striker |
| ⚡ Winger | Classic, Inside Forward, Wide Playmaker |
| ⚽ Striker | Poacher, Target Man, False Nine, Advanced Forward |
| 🎲 Specialist | Set Piece Specialist |

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **AI**: Google Gemini API
- **PDF Export**: jsPDF, html2canvas

## 📄 License

MIT License - feel free to use this project for your own scouting needs!

## 🙏 Acknowledgments

- Data format compatible with Wyscout exports
- Inspired by professional football analytics platforms

---

<div align="center">
Made with ❤️ for football scouts and analysts
</div>
