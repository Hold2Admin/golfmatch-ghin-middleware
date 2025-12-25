CREATE   PROCEDURE dbo.usp_CreateHoleDefaults
(
    @CourseID INT,
    @Gender   CHAR(1)   -- 'M' or 'W'
)
AS
BEGIN
    SET NOCOUNT ON;

    IF @Gender NOT IN ('M','W')
        THROW 50000, 'Gender must be ''M'' or ''W''.', 1;

    DECLARE @DefaultTeeID INT;

    SELECT @DefaultTeeID = cd.DefaultTeeID
    FROM dbo.CourseDefaults cd
    WHERE cd.CourseID = @CourseID
      AND cd.Gender   = @Gender;

    IF @DefaultTeeID IS NULL
        THROW 50001, 'Default tee not found for this course and gender.', 1;

    -- Insert 18 placeholder rows only if missing
    ;WITH N AS
    (
        SELECT v FROM (VALUES
            (1),(2),(3),(4),(5),(6),(7),(8),(9),
            (10),(11),(12),(13),(14),(15),(16),(17),(18)
        ) x(v)
    )
    INSERT INTO dbo.HoleDefaults
        (DefaultTeeID, Gender, HoleNumber, Par, Handicap)
    SELECT
        @DefaultTeeID,
        @Gender,
        n.v,
        4,       -- placeholder Par (valid for all courses)
        n.v      -- placeholder Handicap (1..18)
    FROM N n
    WHERE NOT EXISTS
    (
        SELECT 1
        FROM dbo.HoleDefaults hd
        WHERE hd.DefaultTeeID = @DefaultTeeID
          AND hd.Gender       = @Gender
          AND hd.HoleNumber   = n.v
    );
END;
