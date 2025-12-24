# Quick Start Guide - GHIN Middleware

## ✅ Project Created Successfully!

Your GHIN middleware project has been initialized at:
```
C:\dev\golfmatch-ghin-middleware
```

## 🚀 Next Steps

### 1. Open the Project in VS Code

```powershell
cd C:\dev\golfmatch-ghin-middleware
code .
```

### 2. Start the Development Server

The server is already running on `http://localhost:5001`

If it's not running, start it with:
```powershell
npm run dev
```

### 3. Test the API

Open the test console in your browser:
```
file:///C:/dev/golfmatch-ghin-middleware/test-api.html
```

Or test via PowerShell:
```powershell
# Health check
Invoke-WebRequest -Uri "http://localhost:5001/api/v1/health" | Select-Object -ExpandProperty Content

# Get player (mock data)
Invoke-WebRequest -Uri "http://localhost:5001/api/v1/players/1234567" | Select-Object -ExpandProperty Content

# Get course (mock data)
Invoke-WebRequest -Uri "http://localhost:5001/api/v1/courses/GHIN-54321" | Select-Object -ExpandProperty Content
```

## 📁 Project Structure

```
golfmatch-ghin-middleware/
├── src/
│   ├── index.js              ✅ Main server (Express app)
│   ├── config/               ✅ Environment configuration
│   ├── routes/               ✅ API endpoints
│   │   ├── health.js         ✅ Health check
│   │   ├── players.js        ✅ Player endpoints
│   │   └── courses.js        ✅ Course endpoints
│   ├── services/
│   │   ├── ghinClient.js     ✅ GHIN API client (MOCK mode)
│   │   └── transformers/     ✅ Data transformation logic
│   ├── mocks/                ✅ Realistic test data
│   └── utils/                ✅ Logger & utilities
├── .env.local                ✅ Your environment variables
├── package.json              ✅ Dependencies
└── test-api.html             ✅ Browser test console
```

## 🎯 Available Endpoints (All Working with Mock Data!)

### Player Endpoints
- ✅ `GET /api/v1/players/:ghinNumber` - Get single player
- ✅ `POST /api/v1/players/batch` - Get multiple players
- ✅ `POST /api/v1/players/search` - Search by name/club

### Course Endpoints
- ✅ `GET /api/v1/courses/:ghinCourseId` - Get course with all tees/holes
- ✅ `POST /api/v1/courses/search` - Search courses

### Admin Endpoints
- ✅ `GET /api/v1/health` - Health check

## 🧪 Mock Data Available

**Players** (test GHIN numbers):
- `1234567` - Clayton Cobb (9.4 handicap)
- `2345678` - Michael Draskin (+1.0 handicap - plus player!)
- `3456789` - Ryan Kayton (2.3 handicap)

**Courses**:
- `GHIN-54321` - Indian Hills Country Club
  - Blue tees (Men & Women)
  - White tees (Men)
  - Full 18-hole data with pars, handicaps, yardages

## 🔧 What's Next?

### Phase 1 (Completed ✅)
- ✅ Project structure created
- ✅ Basic endpoints working
- ✅ Mock GHIN data
- ✅ Data transformers (handicap parsing, course normalization)

### Phase 2 (Next Steps)
1. **Initialize Git Repository**:
   ```powershell
   git init
   git add .
   git commit -m "Initial commit - GHIN middleware project"
   ```

2. **Create GitHub Repo**:
   - Go to GitHub (Hold2Admin account)
   - Create new repo: `golfmatch-ghin-middleware`
   - Connect:
     ```powershell
     git remote add origin https://github.com/Hold2Admin/golfmatch-ghin-middleware.git
     git branch -M main
     git push -u origin main
     ```

3. **Set Up Azure Resources**:
   - Azure App Service (can share existing plan to save costs)
   - Azure SQL Database (golfdb-ghin-cache)
   - Azure Cache for Redis (optional - can add later)

4. **Configure GitHub Actions**:
   - Deploy to Azure App Service on push to main

### Phase 3 (Integrate with Fore Play)
- Add API endpoint to Fore Play config
- Update Course Editor with "Import from GHIN" button
- Add handicap refresh to GeneratePairings

### Phase 4 (When GHIN Access Arrives)
- Update `src/services/ghinClient.js` (one file!)
- Replace mock functions with real GHIN API calls
- No other changes needed!

## 📝 Configuration

The `.env.local` file has placeholder values. Update these as you progress:

**Now (Development)**:
- ✅ PORT, NODE_ENV (already set)
- ⏳ Database (when you create Azure SQL)
- ⏳ Redis (optional for now)
- ✅ APPLICATIONINSIGHTS_CONNECTION_STRING (copy from golfmatch-insights to remove SDK deprecation warning)

**Later (Production)**:
- ⏳ GHIN API credentials (when access granted)
- ⏳ Fore Play API key
- ⏳ Azure Key Vault integration

## 🎉 You're Ready to Build!

The middleware is **fully functional** right now with mock data. You can:
1. Test all endpoints locally
2. Develop integrations with your main Golf Match API
3. Deploy to Azure (shares existing App Service Plan - $0 extra cost)
4. Build and test the complete workflow before GHIN access

When GHIN access arrives, you'll literally just update one service file (`ghinClient.js`) - everything else stays the same!

## 🆘 Troubleshooting

**Server won't start?**
```powershell
# Check if port 5001 is in use
netstat -ano | findstr :5001

# Kill process if needed
taskkill /PID [PID] /F

# Restart server
npm run dev
```

**Need help?**
Check the logs at `logs/combined.log` and `logs/error.log`

---

**Created**: December 22, 2025
**Status**: Phase 1 Complete - Ready for GitHub & Azure deployment!
