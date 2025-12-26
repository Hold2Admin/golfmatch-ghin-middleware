# GHIN Mock Database Setup

## Overview

This directory contains the schema and seed data for the GHIN mock database. This replaces the static `ghinData.js` file and allows the middleware to simulate GHIN API behavior more realistically by querying a database.

## Database Tables

### GHIN_Courses
Stores basic course information (name, city, state, facility ID)

### GHIN_Tees  
Stores tee information with embedded ratings/slope (teeName, gender, isDefault, courseRating, slope, par, yardage)

### GHIN_Holes
Stores 18 holes per tee (holeNumber, par, handicap, yardage)

## Enabling Database Mode

Set the environment variable:
```
GHIN_USE_DATABASE=true
```

When enabled, the middleware queries these tables instead of the mock file. This allows:
- Adding/editing courses without restarting the middleware
- More realistic simulation of production behavior  
- Testing sync logic with dynamic data

## Setup Instructions

### 1. Create Tables

Run the SQL scripts in order against your `golfdb` database:

```sql
-- 1. Create tables
.\001_create_ghin_tables.sql

-- 2. Seed Colorado courses
.\002_seed_ghin_data.sql

-- 3. Seed California courses
.\003_seed_ca_courses.sql
```

### 2. Configure Secrets

Ensure your Key Vault has these secrets:
- `AZURE-SQL-SERVER` (e.g., `golfmatchserver.database.windows.net`)
- `AZURE-SQL-DATABASE` (e.g., `golfdb`)
- `AZURE-SQL-USER`
- `AZURE-SQL-PASSWORD`

### 3. Enable Database Mode

Update your `.env.local` or App Service configuration:
```
GHIN_USE_DATABASE=true
```

### 4. Restart Middleware

The middleware will now query the database instead of the mock file.

## Current Data

**Colorado (3 courses):**
- Cedar Ridge Golf Club (Boulder) - 4 tees (Blue M/W, Red M/W)
- Arrowhead Golf Club (Littleton) - 3 tees (Championship M/W, Resort M)
- The Broadmoor East Course (Colorado Springs) - 4 tees (Tournament M/W, Members M, Ladies W)

**California (3 courses):**
- Torrey Pines South Course (San Diego) - 3 tees (Black M/W, Gold M)
- Olympic Club Lake Course (San Francisco) - 4 tees (Tournament M/W, Players M, Member W)
- Riviera Country Club (Pacific Palisades) - 4 tees (Championship M/W, Blue M, White M)

## Adding More Courses

To add new courses, insert into the three tables:

```sql
-- 1. Add course
INSERT INTO GHIN_Courses (courseId, courseName, city, state, country, facilityId) 
VALUES ('GHIN-XXXXX', 'Course Name', 'City', 'ST', 'USA', 'GHIN-FAC-XXXX');

-- 2. Add tees
INSERT INTO GHIN_Tees (teeId, courseId, teeName, gender, isDefault, courseRating, slope, par, yardage)
VALUES ('GHIN-TEE-XXXX', 'GHIN-XXXXX', 'Blue', 'M', 1, 72.5, 135, 72, 6500);

-- 3. Add 18 holes for each tee
INSERT INTO GHIN_Holes (teeId, holeNumber, par, handicap, yardage)
VALUES 
  ('GHIN-TEE-XXXX', 1, 4, 7, 380),
  ('GHIN-TEE-XXXX', 2, 5, 3, 520),
  -- ... repeat for holes 3-18
```

No middleware restart required - changes are visible immediately.

## Switching Back to Mock File

Set `GHIN_USE_DATABASE=false` and restart the middleware to use `ghinData.js` again.
