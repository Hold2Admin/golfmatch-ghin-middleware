CREATE PROCEDURE dbo.usp_GetCoursesDelta
    @SinceUtc DATETIME2(3) = NULL,
    @State    NVARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        c.CourseID,
        c.CourseName,
        c.City,
        c.State,
        c.LastUpdatedUtc
    FROM dbo.Courses AS c
    WHERE (@State   IS NULL OR c.State = @State)
      AND (@SinceUtc IS NULL OR c.LastUpdatedUtc > @SinceUtc)
    ORDER BY c.State, c.CourseName;
END;
