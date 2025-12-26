# GHIN Mock DB Helper

Reusable guidance + script for inserting and updating courses in the middleware mock database.

## Why timestamps matter
- The Fore Play sync first checks the course-level timestamp. If the course `updatedAt` hasn't changed, it skips fetching tees entirely for that course.
- When you change a tee or a hole, also bump the course `updatedAt`. Otherwise, tee changes may go unnoticed.

Recommended pattern:
```
-- Tee-level change
UPDATE GHIN_Tees SET courseRating = 76.3, updatedAt = GETUTCDATE() WHERE teeId = 'GHIN-TEE-3001';
-- Course-level bump to ensure sync notices
UPDATE GHIN_Courses SET updatedAt = GETUTCDATE() WHERE courseId = 'GHIN-76543';
```

## Helper script
Path: scripts/mockdb-helper.js

Commands:
- add-course: Insert a full course from JSON file
- update-tee: Update tee fields (courseRating, slope, par, yardage) and bump timestamps
- update-hole: Update a single hole (par, handicap, yardage) and bump timestamps
- bump-course: Force a course `updatedAt` refresh
- show-course: List all tees for a course with key fields

Usage examples:
```
# Add a new course from JSON
node scripts/mockdb-helper.js add-course --file ./JSON/course-template.json

# Update a tee and bump timestamps
node scripts/mockdb-helper.js update-tee --teeId GHIN-TEE-3001 --courseRating 76.3

# Update a specific hole baseline (and bump timestamps)
node scripts/mockdb-helper.js update-hole --teeId GHIN-TEE-1001 --hole 1 --yardage 392

# Explicitly bump course timestamp
node scripts/mockdb-helper.js bump-course --courseId GHIN-76543

# Inspect tees for a course
node scripts/mockdb-helper.js show-course --courseId GHIN-76543
```

## PowerShell shortcuts (gm.ps1)
Use these wrappers to avoid remembering node arguments:

- GmMock-ShowCourse -CourseId GHIN-76543
- GmMock-UpdateTee -TeeId GHIN-TEE-3001 -CourseRating 76.3 -Slope 146
- GmMock-UpdateHole -TeeId GHIN-TEE-1001 -Hole 1 -Yardage 392
- GmMock-AddCourse -File .\JSON\course-template.json
- GmMock-AddRedRocks
- GmMock-TestWizard  # interactive menu for the common tasks

Notes:
- All update commands automatically bump tee.updatedAt and course.updatedAt so Fore Play’s incremental sync detects changes.
- GmMock-AddRedRocks inserts the Red Rocks test course using db-schema/ghin-mock/005_seed_red_rocks.sql and will fail if it already exists.

## JSON template
You can create a new course from a JSON descriptor. See JSON/course-template.json for structure:
```
{
  "courseId": "GHIN-99999",
  "courseName": "Sample Golf Club",
  "city": "City",
  "state": "CO",
  "country": "USA",
  "facilityId": "GHIN-FAC-9999",
  "tees": [
    {
      "teeId": "GHIN-TEE-9001",
      "teeName": "Blue",
      "gender": "M",
      "isDefault": true,
      "courseRating": 72.0,
      "slope": 135,
      "par": 72,
      "yardage": 6550,
      "holes": [
        { "holeNumber": 1, "par": 4, "handicap": 7, "yardage": 410 }
      ]
    }
  ]
}
```

## Notes
- The helper uses Key Vault secrets via src/config/secrets; no .env file needed.
- All updates set `updatedAt = GETUTCDATE()`; tee/holes also bump the parent course timestamp by default.
- Keep gender values to "M" or "W".
