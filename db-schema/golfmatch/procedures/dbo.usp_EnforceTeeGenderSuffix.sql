

---------------------------------------------------------------
-- 3. Enforce Option B naming for a single (CourseID, BaseTeeName)
---------------------------------------------------------------
CREATE   PROCEDURE dbo.usp_EnforceTeeGenderSuffix
(
    @CourseID     INT,
    @BaseTeeName  NVARCHAR(100)
)
AS
BEGIN
    SET NOCOUNT ON;

    -- Normalize just in case caller passes a suffixed name
    SET @BaseTeeName = dbo.ufn_GetBaseTeeName(@BaseTeeName);

    DECLARE @MenTeeID   INT;
    DECLARE @WomenTeeID INT;

    -- Find associated tees by gender for this course/base name
    SELECT @MenTeeID = t.TeeID
    FROM dbo.Tees t
    JOIN dbo.TeeRatings r ON r.TeeID = t.TeeID AND r.Gender = 'M'
    WHERE t.CourseID = @CourseID
      AND t.BaseTeeName = @BaseTeeName;

    SELECT @WomenTeeID = t.TeeID
    FROM dbo.Tees t
    JOIN dbo.TeeRatings r ON r.TeeID = t.TeeID AND r.Gender = 'W'
    WHERE t.CourseID = @CourseID
      AND t.BaseTeeName = @BaseTeeName;

    -- Case 1: both genders exist → add suffixes to both
    IF @MenTeeID IS NOT NULL AND @WomenTeeID IS NOT NULL
    BEGIN
        UPDATE dbo.Tees
        SET TeeName     = @BaseTeeName + ' (M)',
            BaseTeeName = @BaseTeeName
        WHERE TeeID = @MenTeeID;

        UPDATE dbo.Tees
        SET TeeName     = @BaseTeeName + ' (W)',
            BaseTeeName = @BaseTeeName
        WHERE TeeID = @WomenTeeID;
    END
    ELSE
    BEGIN
        -- Case 2: only one gender exists → no suffix
        IF @MenTeeID IS NOT NULL
        BEGIN
            UPDATE dbo.Tees
            SET TeeName     = @BaseTeeName,
                BaseTeeName = @BaseTeeName
            WHERE TeeID = @MenTeeID;
        END;

        IF @WomenTeeID IS NOT NULL
        BEGIN
            UPDATE dbo.Tees
            SET TeeName     = @BaseTeeName,
                BaseTeeName = @BaseTeeName
            WHERE TeeID = @WomenTeeID;
        END;
    END;
END;
