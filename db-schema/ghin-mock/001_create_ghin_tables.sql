-- GHIN Mock Database Tables
-- These tables simulate the GHIN database for development/testing
-- Middleware queries these instead of static mock files

-- Drop existing tables if they exist (in reverse order due to foreign keys)
IF OBJECT_ID('GHIN_Holes', 'U') IS NOT NULL DROP TABLE GHIN_Holes;
IF OBJECT_ID('GHIN_Tees', 'U') IS NOT NULL DROP TABLE GHIN_Tees;
IF OBJECT_ID('GHIN_Courses', 'U') IS NOT NULL DROP TABLE GHIN_Courses;
GO

-- Courses table (basic course information)
CREATE TABLE GHIN_Courses (
    courseId VARCHAR(50) PRIMARY KEY,
    courseName NVARCHAR(200) NOT NULL,
    city NVARCHAR(100) NOT NULL,
    state VARCHAR(10) NOT NULL,
    country VARCHAR(10) NOT NULL DEFAULT 'USA',
    facilityId VARCHAR(50) NULL,
    createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    updatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);
GO

-- Tees table (tee information with embedded ratings/slope)
CREATE TABLE GHIN_Tees (
    teeId VARCHAR(50) PRIMARY KEY,
    courseId VARCHAR(50) NOT NULL,
    teeName NVARCHAR(100) NOT NULL,
    gender CHAR(1) NOT NULL CHECK (gender IN ('M', 'W')),
    isDefault BIT NOT NULL DEFAULT 0,
    courseRating DECIMAL(4,1) NOT NULL,
    slope INT NOT NULL,
    par INT NOT NULL,
    yardage INT NOT NULL,
    createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    updatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_GHIN_Tees_Courses FOREIGN KEY (courseId) REFERENCES GHIN_Courses(courseId) ON DELETE CASCADE
);
GO

-- Holes table (18 holes per tee)
CREATE TABLE GHIN_Holes (
    teeId VARCHAR(50) NOT NULL,
    holeNumber INT NOT NULL CHECK (holeNumber BETWEEN 1 AND 18),
    par INT NOT NULL CHECK (par BETWEEN 3 AND 5),
    handicap INT NOT NULL CHECK (handicap BETWEEN 1 AND 18),
    yardage INT NOT NULL,
    createdAt DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT PK_GHIN_Holes PRIMARY KEY (teeId, holeNumber),
    CONSTRAINT FK_GHIN_Holes_Tees FOREIGN KEY (teeId) REFERENCES GHIN_Tees(teeId) ON DELETE CASCADE
);
GO

-- Indexes for common queries
CREATE INDEX IX_GHIN_Courses_State ON GHIN_Courses(state);
CREATE INDEX IX_GHIN_Tees_CourseId ON GHIN_Tees(courseId);
CREATE INDEX IX_GHIN_Tees_Gender ON GHIN_Tees(gender);
GO
