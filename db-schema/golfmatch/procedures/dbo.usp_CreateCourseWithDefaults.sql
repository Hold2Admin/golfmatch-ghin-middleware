
CREATE PROCEDURE [dbo].[usp_CreateCourseWithDefaults]
    @CourseName NVARCHAR(100),
    @City       NVARCHAR(100) = NULL,
    @State      NVARCHAR(50)  = NULL
AS
BEGIN
PRINT 'usp_CreateCourseWithDefaults START';
    SET NOCOUNT ON;

    DECLARE @CourseID          INT;
    DECLARE @DefaultMenTeeID   INT = NULL;
    DECLARE @DefaultWomenTeeID INT = NULL;
    DECLARE @HasMenTees        BIT;
    DECLARE @HasWomenTees      BIT;

    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (SELECT 1 FROM dbo.Courses WHERE CourseName = @CourseName)
        BEGIN
            INSERT INTO dbo.Courses (CourseName, City, State)
            VALUES (@CourseName, @City, @State);
        END;

        SELECT @CourseID = CourseID
        FROM dbo.Courses
        WHERE CourseName = @CourseName;

        SELECT @HasMenTees =
            CASE WHEN EXISTS (
                SELECT 1
                FROM dbo.TeeRatings tr
                JOIN dbo.Tees t ON tr.TeeID = t.TeeID
                WHERE t.CourseID = @CourseID
                  AND tr.Gender  = 'M'
            ) THEN 1 ELSE 0 END;

        SELECT @HasWomenTees =
            CASE WHEN EXISTS (
                SELECT 1
                FROM dbo.TeeRatings tr
                JOIN dbo.Tees t ON tr.TeeID = t.TeeID
                WHERE t.CourseID = @CourseID
                  AND tr.Gender  = 'W'
            ) THEN 1 ELSE 0 END;

        IF @HasMenTees = 0 AND @HasWomenTees = 0
        BEGIN
            COMMIT TRANSACTION;
            RETURN;
        END;

        IF @HasMenTees = 1
        BEGIN
            SELECT TOP (1) @DefaultMenTeeID = t.TeeID
            FROM dbo.TeeRatings tr
            JOIN dbo.Tees t ON tr.TeeID = t.TeeID
            WHERE t.CourseID = @CourseID
              AND tr.Gender  = 'M'
            ORDER BY tr.CourseRating DESC;
        END;

        IF @HasWomenTees = 1
        BEGIN
            SELECT TOP (1) @DefaultWomenTeeID = t.TeeID
            FROM dbo.TeeRatings tr
            JOIN dbo.Tees t ON tr.TeeID = t.TeeID
            WHERE t.CourseID = @CourseID
              AND tr.Gender  = 'W'
            ORDER BY tr.CourseRating ASC;
        END;

        DELETE FROM dbo.CourseDefaults
        WHERE CourseID = @CourseID;

        IF @DefaultMenTeeID IS NOT NULL
        BEGIN
            INSERT INTO dbo.CourseDefaults (CourseID, Gender, DefaultTeeID)
            VALUES (@CourseID, 'M', @DefaultMenTeeID);
        END;

        IF @DefaultWomenTeeID IS NOT NULL
        BEGIN
            INSERT INTO dbo.CourseDefaults (CourseID, Gender, DefaultTeeID)
            VALUES (@CourseID, 'W', @DefaultWomenTeeID);
        END;

        IF @DefaultMenTeeID IS NOT NULL
        BEGIN
            EXEC dbo.usp_CreateHoleDefaults @CourseID, 'M';
        END;

        IF @DefaultWomenTeeID IS NOT NULL
        BEGIN
            EXEC dbo.usp_CreateHoleDefaults @CourseID, 'W';
        END;

        -----------------------------------------------------------
        -- TOUCH LastUpdatedUtc (ONLY REQUIRED CHANGE)
        -----------------------------------------------------------
        UPDATE dbo.Courses
        SET LastUpdatedUtc = SYSUTCDATETIME()
        WHERE CourseID = @CourseID;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

PRINT 'usp_CreateCourseWithDefaults END';
END
