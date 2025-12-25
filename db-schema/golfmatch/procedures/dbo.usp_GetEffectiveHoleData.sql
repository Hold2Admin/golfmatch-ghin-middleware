----------------------------------------------------------
-- usp_GetEffectiveHoleData (gender-aware defaults/overrides)
----------------------------------------------------------
CREATE   PROCEDURE dbo.usp_GetEffectiveHoleData
    @TeeID  INT,
    @Gender CHAR(1)   -- 'M' or 'W'
AS
BEGIN
    SET NOCOUNT ON;

    IF @Gender NOT IN ('M','W')
    BEGIN
        RAISERROR('Gender must be ''M'' or ''W''.', 16, 1);
        RETURN;
    END;

    DECLARE @CourseID INT;
    DECLARE @DefaultTeeID INT;
    DECLARE @DefaultsGender CHAR(1);

    -- 1. Resolve CourseID from Tee
    SELECT @CourseID = CourseID
    FROM dbo.Tees
    WHERE TeeID = @TeeID;

    IF @CourseID IS NULL
    BEGIN
        RAISERROR('TeeID %d not found in Tees.', 16, 1, @TeeID);
        RETURN;
    END;

    -- 2. Find default tee for requested gender
    SELECT @DefaultTeeID = DefaultTeeID
    FROM dbo.CourseDefaults
    WHERE CourseID = @CourseID
      AND Gender   = @Gender;

    IF @DefaultTeeID IS NOT NULL
        SET @DefaultsGender = @Gender;
    ELSE
    BEGIN
        -- Fallback: use Men's default tee
        SELECT @DefaultTeeID = DefaultTeeID
        FROM dbo.CourseDefaults
        WHERE CourseID = @CourseID
          AND Gender   = 'M';

        SET @DefaultsGender = 'M';
    END;

    IF @DefaultTeeID IS NULL
    BEGIN
        RAISERROR('No CourseDefaults found for CourseID %d.', 16, 1, @CourseID);
        RETURN;
    END;

    -- 3. If no HoleDefaults exist for the chosen defaults gender,
    --    but Men's rows do exist, fall back to Men's hole definitions.
    IF NOT EXISTS (
        SELECT 1
        FROM dbo.HoleDefaults
        WHERE DefaultTeeID = @DefaultTeeID
          AND Gender       = @DefaultsGender
    )
    AND EXISTS (
        SELECT 1
        FROM dbo.HoleDefaults
        WHERE DefaultTeeID = @DefaultTeeID
          AND Gender       = 'M'
    )
    BEGIN
        SET @DefaultsGender = 'M';
    END;

    -- 4. Return effective Par/Handicap per hole
    SELECT
        d.HoleNumber,
        COALESCE(o.Par,      d.Par)      AS Par,
        COALESCE(o.Handicap, d.Handicap) AS Handicap
    FROM dbo.HoleDefaults d
    LEFT JOIN dbo.HoleOverrides o
        ON  o.TeeID      = @TeeID
        AND o.Gender     = @Gender      -- overrides are per actual player gender
        AND o.HoleNumber = d.HoleNumber
    WHERE d.DefaultTeeID = @DefaultTeeID
      AND d.Gender       = @DefaultsGender
    ORDER BY d.HoleNumber;
END;
