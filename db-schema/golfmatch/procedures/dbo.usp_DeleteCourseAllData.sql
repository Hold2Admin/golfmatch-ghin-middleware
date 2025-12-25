------------------------------------------------------------
-- Stored Procedure: Delete Course + All Related Data
------------------------------------------------------------
CREATE   PROCEDURE dbo.usp_DeleteCourseAllData
(
    @CourseID INT = NULL,
    @CourseName NVARCHAR(100) = NULL
)
AS
BEGIN
    SET NOCOUNT ON;

    ------------------------------------------------------------
    -- Resolve CourseID if CourseName was provided
    ------------------------------------------------------------
    IF @CourseID IS NULL AND @CourseName IS NOT NULL
    BEGIN
        SELECT @CourseID = CourseID
        FROM dbo.Courses
        WHERE CourseName = @CourseName;
    END

    ------------------------------------------------------------
    -- Validate
    ------------------------------------------------------------
    IF @CourseID IS NULL
    BEGIN
        RAISERROR('Course not found. Provide a valid CourseID or CourseName.', 16, 1);
        RETURN;
    END


    ------------------------------------------------------------
    -- 1) Delete HoleOverrides
    ------------------------------------------------------------
    DELETE ho
    FROM dbo.HoleOverrides ho
    JOIN dbo.Tees t ON t.TeeID = ho.TeeID
    WHERE t.CourseID = @CourseID;


    ------------------------------------------------------------
    -- 2) Delete HoleDefaults
    ------------------------------------------------------------
    DELETE hd
    FROM dbo.HoleDefaults hd
    JOIN dbo.Tees t ON t.TeeID = hd.DefaultTeeID
    WHERE t.CourseID = @CourseID;


    ------------------------------------------------------------
    -- 3) Delete TeeRatings
    ------------------------------------------------------------
    DELETE tr
    FROM dbo.TeeRatings tr
    JOIN dbo.Tees t ON t.TeeID = tr.TeeID
    WHERE t.CourseID = @CourseID;


    ------------------------------------------------------------
    -- 4) Delete Tees
    ------------------------------------------------------------
    DELETE FROM dbo.Tees
    WHERE CourseID = @CourseID;


    ------------------------------------------------------------
    -- 5) Delete CourseDefaults
    ------------------------------------------------------------
    DELETE FROM dbo.CourseDefaults
    WHERE CourseID = @CourseID;


    ------------------------------------------------------------
    -- 6) Delete Course
    ------------------------------------------------------------
    DELETE FROM dbo.Courses
    WHERE CourseID = @CourseID;


    PRINT 'Course and all related data deleted successfully.';
END
